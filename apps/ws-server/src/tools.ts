import { eq } from 'drizzle-orm';
import { getDb, customers, policies, claims, claimEvents, evidence } from '@bella/db';
import pino from 'pino';

const logger = pino({ name: 'bella-tools' });

export interface ToolContext {
  sessionId: string;
  callerPhone: string;
  customerId?: string;
  claimId?: string;
}

type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<object>;

const toolHandlers: Record<string, ToolHandler> = {
  lookup_customer: async (args, _ctx) => {
    const phone = args.phone as string;
    const db = getDb();

    const customer = await db.query.customers.findFirst({
      where: eq(customers.phone, phone),
      with: { policies: true },
    });

    if (!customer) {
      logger.info({ phone }, 'Customer not found');
      return { found: false, message: `No customer found for phone ${phone}` };
    }

    logger.info({ customerId: customer.id, phone }, 'Customer found');
    return {
      found: true,
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
      },
      policies: customer.policies.map((p) => ({
        id: p.id,
        type: p.type,
        planName: p.planName,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    };
  },

  get_policies: async (args) => {
    const customerId = args.customerId as string;
    const db = getDb();

    const results = await db.query.policies.findMany({
      where: eq(policies.customerId, customerId),
    });

    logger.info({ customerId, count: results.length }, 'Policies retrieved');
    return {
      policies: results.map((p) => ({
        id: p.id,
        type: p.type,
        planName: p.planName,
        status: p.status,
        premium: p.premium,
        startDate: p.startDate,
        endDate: p.endDate,
        details: p.details,
      })),
    };
  },

  open_claim: async (args, ctx) => {
    const db = getDb();

    const [claim] = await db
      .insert(claims)
      .values({
        customerId: args.customerId as string,
        policyId: (args.policyId as string) || undefined,
        type: args.type as string,
        status: 'draft',
        description: (args.description as string) || undefined,
        incidentDate: (args.incidentDate as string) || undefined,
        incidentLocation: (args.incidentLocation as string) || undefined,
      })
      .returning();

    await db.insert(claimEvents).values({
      claimId: claim!.id,
      sessionId: ctx.sessionId,
      type: 'system',
      content: 'Claim opened via phone call with Bella AI agent',
      metadata: { callerPhone: ctx.callerPhone },
    });

    logger.info({ claimId: claim!.id, type: args.type }, 'Claim opened');
    return {
      success: true,
      claimId: claim!.id,
      status: 'draft',
      message: `Claim ${claim!.id} has been created in draft status`,
    };
  },

  log_fact: async (args, ctx) => {
    const db = getDb();
    const claimId = args.claimId as string;
    const eventType = (args.type as string) || 'fact';

    await db.insert(claimEvents).values({
      claimId,
      sessionId: ctx.sessionId,
      type: eventType as 'fact' | 'observation' | 'action' | 'system',
      content: args.content as string,
    });

    const currentClaim = await db.query.claims.findFirst({
      where: eq(claims.id, claimId),
    });

    if (currentClaim?.status === 'draft') {
      await db
        .update(claims)
        .set({ status: 'gathering_info', updatedAt: new Date() })
        .where(eq(claims.id, claimId));
    }

    logger.info({ claimId, eventType }, 'Fact logged');
    return { success: true, message: 'Fact recorded' };
  },

  request_evidence: async (args, ctx) => {
    const db = getDb();
    const claimId = args.claimId as string;
    const fileType = args.fileType as 'photo' | 'document' | 'video';
    const description = args.description as string;

    const uploadToken = crypto.randomUUID();

    await db.insert(evidence).values({
      claimId,
      sessionId: ctx.sessionId,
      uploadToken,
      fileType,
      status: 'pending',
    });

    const uploadUrl = `${process.env.WEB_APP_URL || 'https://app.safeguard.example.com'}/upload/${uploadToken}`;

    if (ctx.callerPhone && process.env.TWILIO_ACCOUNT_SID) {
      try {
        const twilio = await import('twilio');
        const twilioClient = twilio.default(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN,
        );
        await twilioClient.messages.create({
          body: `SafeGuard Insurance: Please upload your ${fileType} here: ${uploadUrl}\n\nRe: ${description}`,
          from: process.env.TWILIO_PHONE_NUMBER || '',
          to: ctx.callerPhone,
        });
        logger.info({ claimId, phone: ctx.callerPhone }, 'Evidence SMS sent');
      } catch (err) {
        logger.error({ err, claimId }, 'Failed to send evidence SMS');
      }
    }

    logger.info({ claimId, uploadToken, fileType }, 'Evidence requested');
    return {
      success: true,
      uploadToken,
      uploadUrl,
      message: `Upload link sent to customer for ${description}`,
    };
  },

  upsell_product: async (args, ctx) => {
    const db = getDb();
    const customerId = args.customerId as string;
    const product = args.product as string;
    const reason = args.reason as string;

    if (ctx.claimId) {
      await db.insert(claimEvents).values({
        claimId: ctx.claimId,
        sessionId: ctx.sessionId,
        type: 'action',
        content: `Upsell suggested: ${product} — ${reason}`,
        metadata: { customerId, product, reason },
      });
    }

    logger.info({ customerId, product }, 'Upsell suggested');
    return {
      success: true,
      message: `Noted product suggestion: ${product}`,
      product,
      reason,
    };
  },

  transfer_to_human: async (args, ctx) => {
    const reason = args.reason as string;
    const department = (args.department as string) || 'general';

    if (ctx.claimId) {
      const db = getDb();
      await db.insert(claimEvents).values({
        claimId: ctx.claimId,
        sessionId: ctx.sessionId,
        type: 'action',
        content: `Transfer to human requested: ${reason} (department: ${department})`,
      });
    }

    logger.info({ reason, department }, 'Transfer to human requested');
    return {
      success: true,
      transferred: true,
      department,
      message: `Transferring to ${department} department. Reason: ${reason}`,
    };
  },
};

/**
 * Execute a tool by name with the given arguments and session context.
 *
 * @param name - Tool function name (must match a TOOL_DECLARATIONS entry)
 * @param args - Arguments parsed from the LLM function call
 * @param ctx - Current session context (sessionId, callerPhone, etc.)
 * @returns Tool execution result object
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<object> {
  const handler = toolHandlers[name];
  if (!handler) {
    logger.warn({ name }, 'Unknown tool called');
    return { error: true, message: `Unknown tool: ${name}` };
  }

  try {
    logger.info({ tool: name, args }, 'Executing tool');
    const result = await handler(args, ctx);
    logger.info({ tool: name }, 'Tool executed successfully');
    return result;
  } catch (err) {
    logger.error({ tool: name, err }, 'Tool execution failed');
    return { error: true, message: `Tool ${name} failed: ${(err as Error).message}` };
  }
}

/**
 * Get the list of all available tool names.
 *
 * @returns Array of tool name strings
 */
export function getAvailableTools(): string[] {
  return Object.keys(toolHandlers);
}
