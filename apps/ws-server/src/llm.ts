import type { Session } from "./types.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { handleToolCall } from "./tools.ts";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { type LanguageModel } from "ai";
import pino from "pino";

const logger = pino({ name: "bella-llm" });

/** Supported LLM providers */
export type LLMProvider = "gemini" | "groq";

/** Resolve the active LLM provider from env */
export function getLLMProvider(): LLMProvider {
  const raw = process.env.LLM_PROVIDER?.toLowerCase();
  if (raw === "groq") return "groq";
  return "gemini";
}

/** Model IDs per provider */
const MODEL_IDS: Record<LLMProvider, string> = {
  groq: "openai/gpt-oss-20b",
  gemini: "gemini-2.0-flash",
};

/**
 * Create a Vercel AI SDK `LanguageModel` for the configured provider.
 *
 * Reads `LLM_PROVIDER` (gemini | groq) and the matching API key from env.
 * Logs the resolved configuration at startup level.
 */
export function createModel(): LanguageModel {
  const provider = getLLMProvider();
  const modelId = MODEL_IDS[provider];

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is required when LLM_PROVIDER=groq");
    const groq = createGroq({ apiKey });
    logger.info(`[BELLA:CONFIG] LLM provider: groq (${modelId})`);
    return groq(modelId);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
  const google = createGoogleGenerativeAI({ apiKey });
  logger.info(`[BELLA:CONFIG] LLM provider: gemini (${modelId})`);
  return google(modelId);
}

/** Tool definition shape for LLM function-calling */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    >;
    required: string[];
  };
}

/** All 8 tools available to the LLM */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "lookup_customer",
    description:
      "Look up a customer by phone number, name, or date of birth. Use this to identify the caller.",
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Customer phone number with country code",
        },
        name: { type: "string", description: "Customer full name" },
        dob: {
          type: "string",
          description: "Customer date of birth (YYYY-MM-DD)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_policies",
    description:
      "Retrieve all active insurance policies for the current customer. Call this when the customer asks about their coverage or policies.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "open_claim",
    description:
      "Open a new insurance claim for the customer. Use this when a customer wants to file a claim.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Type of insurance claim",
          enum: ["auto", "health", "liability", "home", "life", "travel"],
        },
        description: {
          type: "string",
          description: "Brief description of what happened",
        },
      },
      required: ["type", "description"],
    },
  },
  {
    name: "log_fact",
    description:
      "Log a fact or piece of information. Can be used to record claim details or caller information like their name. When a new caller provides their name, the system automatically creates a customer profile.",
    parameters: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description: "The fact or observation to record",
        },
        category: {
          type: "string",
          description: "Category of the fact",
          enum: [
            "name",
            "customer_name",
            "incident_date",
            "incident_location",
            "description",
            "parties_involved",
            "police_report",
            "injuries",
            "damage",
            "costs",
            "provider",
            "other",
          ],
        },
      },
      required: ["fact"],
    },
  },
  {
    name: "request_evidence",
    description:
      "Send an SMS to the customer with a link to upload photos or documents as evidence for their claim.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Type of evidence being requested",
          enum: ["photo", "document", "video", "receipt", "medical_record"],
        },
        description: {
          type: "string",
          description: "What the customer should upload",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "upsell_product",
    description:
      "Recommend an insurance product to the customer. Use this when the customer might benefit from additional coverage.",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Insurance product to recommend",
          enum: ["auto", "health", "liability", "home", "life", "travel"],
        },
        reason: {
          type: "string",
          description:
            "Why this product is relevant based on the conversation",
        },
      },
      required: ["product", "reason"],
    },
  },
  {
    name: "request_callback",
    description:
      "Request a callback from a specialist for the customer. Use this when the customer needs help beyond what you can provide.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why a callback is needed",
        },
        preferredTime: {
          type: "string",
          description:
            "Customer's preferred callback time (e.g., 'tomorrow morning', '2pm')",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "end_call",
    description:
      "End the current call. Call this ONLY when the customer explicitly says goodbye.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "change_language",
    description:
      "Switch the conversation language and TTS voice. Use this when the customer speaks in a different language or explicitly requests a language switch. Supported: en (English), de (German), es (Spanish).",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "ISO 639-1 language code to switch to",
          enum: ["en", "de", "es"],
        },
      },
      required: ["language"],
    },
  },
];

/** Total number of tools available to the LLM */
export const TOOL_COUNT = TOOL_DEFINITIONS.length;

/**
 * Format customer context for injection into the system prompt.
 *
 * @returns A human-readable context block, or an empty-string note for unknown callers.
 */
export function formatCustomerContext(session: Session): string {
  const { customer, policies, activeClaim } = session;

  if (!customer) {
    return "## Customer Context\nUnknown caller. No customer record found yet. Ask for their name and try to help.";
  }

  const lines: string[] = [
    "## Customer Context",
    `Name: ${customer.firstName} ${customer.lastName}`,
    `Phone: ${customer.phone}`,
    `Email: ${customer.email}`,
    `DOB: ${customer.dob}`,
  ];

  if (policies.length > 0) {
    lines.push("");
    lines.push("### Active Policies");
    for (const p of policies) {
      lines.push(`- ${p.type.toUpperCase()}: ${p.planName} (${p.status}) — ${p.startDate} to ${p.endDate}`);
    }
  } else {
    lines.push("\nNo active policies on file.");
  }

  if (activeClaim) {
    lines.push("");
    lines.push("### Open Claim");
    lines.push(`- Claim ID: ${activeClaim.id}`);
    lines.push(`- Type: ${activeClaim.type}`);
    lines.push(`- Status: ${activeClaim.status}`);
    lines.push(`- Description: ${activeClaim.description}`);
  }

  return lines.join("\n");
}

/**
 * Build the complete system instruction for the LLM session.
 *
 * Combines the externalized prompt template with live customer context.
 */
export function getSystemPrompt(session: Session): string {
  const customerContext = formatCustomerContext(session);
  return buildSystemPrompt(customerContext);
}

/**
 * Process tool calls returned by the LLM and return results.
 *
 * @param toolCalls - Array of tool call objects from the LLM response
 * @param session - The active call session
 * @returns Array of tool results to feed back to the LLM
 */
export async function processToolCalls(
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
  session: Session,
): Promise<Array<{ name: string; response: Record<string, unknown> }>> {
  const results = [];

  for (const call of toolCalls) {
    const result = await handleToolCall(call.name, call.args, session);
    results.push(result);
  }

  return results;
}
