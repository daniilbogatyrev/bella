import type { Session, InsuranceType, Customer } from "./types.ts";
import {
  createCustomer as dbCreateCustomer,
  createClaim as dbCreateClaim,
  createClaimEvent,
  updateCallSessionCustomer,
  type DbCustomer,
} from "./db.ts";
import {
  ElevenLabsTTSStream,
  type SupportedLanguage,
} from "./elevenlabs-tts.ts";

const VALID_INSURANCE_TYPES = new Set<string>(["auto", "health", "liability", "home", "life", "travel"]);

/** Result returned from every tool handler */
export interface ToolResult {
  name: string;
  response: Record<string, unknown>;
}

/**
 * Dispatch a tool call from the LLM to the appropriate handler.
 *
 * @param name - Tool function name from the LLM
 * @param args - Parsed arguments object
 * @param session - The active call session
 * @returns Tool result to feed back to the LLM
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  session.logger.info({ tool: name, args }, `[BELLA:TOOL] ${name}`);

  switch (name) {
    case "lookup_customer":
      return handleLookupCustomer(args, session);
    case "get_policies":
      return handleGetPolicies(args, session);
    case "open_claim":
      return handleOpenClaim(args, session);
    case "log_fact":
      return handleLogFact(args, session);
    case "request_evidence":
      return handleRequestEvidence(args, session);
    case "upsell_product":
      return handleUpsellProduct(args, session);
    case "request_callback":
      return handleRequestCallback(args, session);
    case "end_call":
      return handleEndCall(session);
    case "change_language":
      return handleChangeLanguage(args, session);
    default:
      session.logger.warn({ tool: name }, "[BELLA:TOOL] Unknown tool called");
      return { name, response: { error: `Unknown tool: ${name}` } };
  }
}

async function handleLookupCustomer(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { phone, name: customerName, dob } = args as {
    phone?: string;
    name?: string;
    dob?: string;
  };

  session.logger.info(
    { phone, customerName, dob },
    "[BELLA:TOOL] lookup_customer",
  );

  const customer = session.customer;

  if (customer) {
    return {
      name: "lookup_customer",
      response: {
        found: true,
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          email: customer.email,
          dob: customer.dob,
        },
      },
    };
  }

  return {
    name: "lookup_customer",
    response: {
      found: false,
      message: "No customer found matching the provided details.",
    },
  };
}

async function handleGetPolicies(
  _args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  session.logger.info("[BELLA:TOOL] get_policies");

  const policies = session.policies;

  if (policies.length === 0) {
    return {
      name: "get_policies",
      response: {
        found: false,
        message: "No active policies found for this customer.",
      },
    };
  }

  return {
    name: "get_policies",
    response: {
      found: true,
      policies: policies.map((p) => ({
        id: p.id,
        type: p.type,
        planName: p.planName,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    },
  };
}

async function handleOpenClaim(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { type, description } = args as {
    type: string;
    description: string;
  };

  session.logger.info({ type, description }, "[BELLA:TOOL] open_claim");

  if (!session.customer) {
    return {
      name: "open_claim",
      response: {
        success: false,
        message:
          "I need to identify the customer first. Please ask for their name or policy number.",
      },
    };
  }

  const customerId = session.customer.id;

  try {
    const claim = await dbCreateClaim({
      customerId,
      type,
      status: "draft",
      description,
    });

    session.activeClaim = {
      ...claim,
      type: claim.type as InsuranceType,
      status: claim.status as import("./types.ts").ClaimStatus,
    };

    // Flush any facts queued before the claim was opened
    if (session.pendingFacts.length > 0) {
      session.logger.info(
        { count: session.pendingFacts.length, claimId: claim.id },
        "[BELLA:TOOL] Flushing pending facts to new claim",
      );
      for (const pf of session.pendingFacts) {
        try {
          await createClaimEvent({
            claimId: claim.id,
            type: "fact",
            description: pf.content,
            metadata: pf.category ? JSON.stringify({ category: pf.category }) : null,
          });
        } catch (err) {
          session.logger.error({ err, claimId: claim.id }, "[BELLA:TOOL] Failed to flush pending fact");
        }
      }
      session.pendingFacts = [];
    }

    return {
      name: "open_claim",
      response: {
        success: true,
        claimId: claim.id,
        message: `Claim ${claim.id} opened successfully as draft.`,
      },
    };
  } catch (err) {
    session.logger.error({ err, customerId, type }, "[BELLA:TOOL] open_claim DB error");
    return {
      name: "open_claim",
      response: { success: false, message: "System error, please try again." },
    };
  }
}

async function handleLogFact(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { fact, category } = args as {
    fact: string;
    category?: string;
  };

  session.logger.info({ fact, category }, "[BELLA:TOOL] log_fact");

  // Auto-create customer profile when the caller gives their name
  if (!session.customer && isNameFact(category, fact)) {
    try {
      const created = await autoCreateCustomer(fact, session);
      if (created) {
        return {
          name: "log_fact",
          response: {
            success: true,
            customerCreated: true,
            customerId: created.id,
            message: `Noted. Customer profile created for ${created.firstName} ${created.lastName}.`,
          },
        };
      }
    } catch (err) {
      session.logger.error({ err, fact }, "[BELLA:TOOL] log_fact auto-create customer failed");
      return {
        name: "log_fact",
        response: { success: false, message: "System error, please try again." },
      };
    }
  }

  if (!session.activeClaim) {
    session.pendingFacts.push({ content: fact, category });
    session.logger.info(
      { pendingCount: session.pendingFacts.length },
      "[BELLA:TOOL] No active claim — fact queued as pending",
    );
    return {
      name: "log_fact",
      response: {
        success: true,
        message: "Fact noted. Will be attached to claim when opened.",
      },
    };
  }

  try {
    await createClaimEvent({
      claimId: session.activeClaim.id,
      type: "fact",
      description: fact,
      metadata: category ? JSON.stringify({ category }) : null,
    });
  } catch (err) {
    session.logger.error({ err, claimId: session.activeClaim.id }, "[BELLA:TOOL] log_fact DB error");
    return {
      name: "log_fact",
      response: { success: false, message: "System error, please try again." },
    };
  }

  return {
    name: "log_fact",
    response: {
      success: true,
      claimId: session.activeClaim.id,
      message: `Fact logged against claim ${session.activeClaim.id}.`,
    },
  };
}

async function handleRequestEvidence(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { type: evidenceType, description } = args as {
    type: string;
    description?: string;
  };

  session.logger.info(
    { evidenceType, description },
    "[BELLA:TOOL] request_evidence",
  );

  if (!session.activeClaim) {
    return {
      name: "request_evidence",
      response: {
        success: false,
        message: "Please open a claim first before requesting evidence.",
      },
    };
  }

  if (!session.customer?.phone) {
    return {
      name: "request_evidence",
      response: {
        success: false,
        message: "No phone number on file to send SMS.",
      },
    };
  }

  const uploadToken = `UPL-${Date.now()}`;

  try {
    await createClaimEvent({
      claimId: session.activeClaim.id,
      type: "evidence_requested",
      description: `${evidenceType} evidence requested via SMS`,
      metadata: JSON.stringify({ uploadToken, evidenceType }),
    });
  } catch (err) {
    session.logger.error({ err, claimId: session.activeClaim.id }, "[BELLA:TOOL] request_evidence DB error");
    return {
      name: "request_evidence",
      response: { success: false, message: "System error, please try again." },
    };
  }

  return {
    name: "request_evidence",
    response: {
      success: true,
      uploadToken,
      message: `SMS sent to ${session.customer.phone} with upload link for ${evidenceType}.`,
    },
  };
}

async function handleUpsellProduct(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { product, reason } = args as {
    product: string;
    reason: string;
  };

  session.logger.info({ product, reason }, "[BELLA:TOOL] upsell_product");

  if (!VALID_INSURANCE_TYPES.has(product)) {
    return {
      name: "upsell_product",
      response: {
        success: false,
        message: `Invalid product: ${product}. Valid options: auto, health, liability, home, life, travel.`,
      },
    };
  }

  if (session.activeClaim) {
    try {
      await createClaimEvent({
        claimId: session.activeClaim.id,
        type: "upsell_attempted",
        description: `Recommended ${product} insurance`,
        metadata: JSON.stringify({ product, reason }),
      });
    } catch (err) {
      session.logger.error({ err, product }, "[BELLA:TOOL] upsell_product DB error");
    }
  }

  return {
    name: "upsell_product",
    response: {
      success: true,
      product,
      message: `Upsell for ${product} noted. Reason: ${reason}`,
    },
  };
}

async function handleRequestCallback(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { reason, preferredTime } = args as {
    reason: string;
    preferredTime?: string;
  };

  session.logger.info(
    { reason, preferredTime },
    "[BELLA:TOOL] request_callback",
  );

  if (session.activeClaim) {
    try {
      await createClaimEvent({
        claimId: session.activeClaim.id,
        type: "callback_requested",
        description: `Callback requested: ${reason}`,
        metadata: JSON.stringify({
          reason,
          preferredTime: preferredTime ?? null,
          phone: session.customer?.phone ?? null,
        }),
      });
    } catch (err) {
      session.logger.error({ err, reason }, "[BELLA:TOOL] request_callback DB error");
    }
  } else {
    session.logger.info({ reason, preferredTime }, "[BELLA:TOOL] Callback requested (no active claim)");
  }

  return {
    name: "request_callback",
    response: {
      success: true,
      message: "Callback request submitted. A specialist will call back soon.",
    },
  };
}

async function handleEndCall(session: Session): Promise<ToolResult> {
  session.logger.info("[BELLA:TOOL] end_call");

  session.endCallRequested = true;

  return {
    name: "end_call",
    response: {
      success: true,
      message: "Call ending. Goodbye message will play before disconnect.",
    },
  };
}

const SUPPORTED_LANGUAGES = new Set<string>(["en", "de", "es"]);

async function handleChangeLanguage(
  args: Record<string, unknown>,
  session: Session,
): Promise<ToolResult> {
  const { language } = args as { language: string };

  session.logger.info({ language }, "[BELLA:TOOL] change_language");

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return {
      name: "change_language",
      response: {
        success: false,
        message: `Unsupported language: ${language}. Supported: en, de, es.`,
      },
    };
  }

  session.language = language;

  if (session.ttsStream && session.ttsStream instanceof ElevenLabsTTSStream) {
    try {
      await session.ttsStream.setLanguage(language as SupportedLanguage);
    } catch (err) {
      session.logger.error({ err, language }, "[BELLA:TOOL] change_language TTS error");
    }
  }

  return {
    name: "change_language",
    response: {
      success: true,
      language,
      message: `Language switched to ${language}. Continue the conversation in the new language.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-create customer helpers
// ---------------------------------------------------------------------------

const NAME_CATEGORIES = new Set(["name", "customer_name", "caller_name"]);

/** Check if a log_fact call is providing a caller's name */
function isNameFact(category: string | undefined, fact: string): boolean {
  if (category && NAME_CATEGORIES.has(category)) return true;
  const lower = fact.toLowerCase();
  return lower.startsWith("my name is ") || lower.startsWith("name: ");
}

/**
 * Parse a name string and create a real customer record in the database.
 * Associates the new customer with the current call session.
 */
async function autoCreateCustomer(
  nameFact: string,
  session: Session,
): Promise<Customer | null> {
  const cleaned = nameFact.replace(/^(my name is |name:\s*)/i, "").trim();

  if (!cleaned) return null;

  const parts = cleaned.split(/\s+/);
  const firstName = parts[0] ?? cleaned;
  const lastName = parts.slice(1).join(" ") || "";

  const customer = await dbCreateCustomer({
    firstName,
    lastName,
    phone: session.callerPhone ?? "",
  });

  // Map DB Customer shape to session Customer shape
  const sessionCustomer: Customer = {
    id: customer.id,
    phone: customer.phone,
    firstName: customer.firstName,
    lastName: customer.lastName,
    dob: customer.dob ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
  };

  session.customer = sessionCustomer;

  // Associate customer with the call session in DB
  await updateCallSessionCustomer(session.callId, customer.id);

  session.logger.info(
    { name: `${firstName} ${lastName}`, phone: session.callerPhone, customerId: customer.id },
    "[BELLA:TOOL] Auto-created customer",
  );

  return sessionCustomer;
}
