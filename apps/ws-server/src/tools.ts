import { eq } from 'drizzle-orm';
import { getDb, policies, claims, claimEvents, evidence } from '@bella/db';
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
  get_policies: async (args) => {
    const customerId = args.customerId as string;
    console.log(`[BELLA:TOOL] get_policies — customerId=${customerId}`);
    const db = getDb();

    const results = await db.query.policies.findMany({
      where: eq(policies.customerId, customerId),
    });

    console.log(`[BELLA:TOOL] get_policies — found ${results.length} policies`);
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
        coveredItems: p.coveredItems,
        notCoveredItems: p.notCoveredItems,
      })),
    };
  },

  open_claim: async (args, ctx) => {
    console.log(`[BELLA:TOOL] open_claim — customerId=${args.customerId} type=${args.type} description="${args.description}"`);
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

    console.log(`[BELLA:TOOL] open_claim — created claimId=${claim!.id}`);
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
    console.log(`[BELLA:TOOL] log_fact — claimId=${claimId} type=${eventType} content="${(args.content as string).substring(0, 80)}"`);

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
    console.log(`[BELLA:TOOL] request_evidence — claimId=${claimId} fileType=${fileType} description="${description}"`);

    const uploadToken = crypto.randomUUID();

    await db.insert(evidence).values({
      claimId,
      sessionId: ctx.sessionId,
      uploadToken,
      fileType,
      status: 'pending',
    });

    const dashboardUrl = process.env.DASHBOARD_PUBLIC_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const uploadUrl = `${dashboardUrl}/upload/${uploadToken}`;

    if (ctx.callerPhone && process.env.TWILIO_ACCOUNT_SID) {
      try {
        const twilio = await import('twilio');
        const twilioClient = twilio.default(
          process.env.TWILIO_API_KEY_SID!,
          process.env.TWILIO_API_KEY_SECRET!,
          { accountSid: process.env.TWILIO_ACCOUNT_SID! },
        );
        await twilioClient.messages.create({
          body: `SafeGuard Insurance: Please upload your ${fileType} here: ${uploadUrl}\n\nRe: ${description}`,
          from: process.env.TWILIO_SMS_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || '',
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
    console.log(`[BELLA:TOOL] upsell_product — customerId=${customerId} product="${product}" reason="${reason}"`);

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

  request_callback: async (args, ctx) => {
    const reason = args.reason as string;
    const department = (args.department as string) || 'general';
    const preferredTime = (args.preferredTime as string) || 'as soon as possible';
    console.log(`[BELLA:TOOL] request_callback — reason="${reason}" department=${department} preferredTime="${preferredTime}"`);

    if (ctx.claimId) {
      const db = getDb();
      await db.insert(claimEvents).values({
        claimId: ctx.claimId,
        sessionId: ctx.sessionId,
        type: 'action',
        content: `Callback requested: ${reason} (department: ${department}, preferred time: ${preferredTime})`,
      });
    }

    logger.info({ reason, department, preferredTime, callerPhone: ctx.callerPhone }, 'Callback request logged');
    return {
      success: true,
      callbackRequested: true,
      department,
      preferredTime,
      message: `Callback request logged for ${department} department. A human agent will call the customer back ${preferredTime}. Reason: ${reason}`,
    };
  },

  change_language: async (args, _ctx) => {
    const language = args.language as string;
    console.log(`[BELLA:TOOL] change_language — language="${language}"`);
    logger.info({ language }, 'Language change requested');
    return {
      success: true,
      language,
      message: `Language changed to ${language}. Please continue the conversation in ${language}.`,
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
    console.log(`[BELLA:TOOL] Unknown tool called: ${name}`);
    logger.warn({ name }, 'Unknown tool called');
    return { error: true, message: `Unknown tool: ${name}` };
  }

  try {
    console.log(`[BELLA:TOOL] Executing ${name}(${JSON.stringify(args)})`);
    const start = Date.now();
    logger.info({ tool: name, args }, 'Executing tool');
    const result = await handler(args, ctx);
    const elapsed = Date.now() - start;
    console.log(`[BELLA:TOOL] ${name} completed in ${elapsed}ms — result=${JSON.stringify(result).substring(0, 200)}`);
    logger.info({ tool: name }, 'Tool executed successfully');
    return result;
  } catch (err) {
    console.error(`[BELLA:TOOL] ${name} failed:`, err);
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
