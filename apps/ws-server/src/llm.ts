import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import { tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import pino from 'pino';
import { executeTool, type ToolContext } from './tools';

const logger = pino({ name: 'bella-llm' });

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'gemini';

export const SYSTEM_PROMPT = `You are Bella, a friendly and empathetic AI insurance agent for SafeGuard Insurance.

## Your Personality
- Warm, professional, and patient — like a helpful neighbor who happens to know insurance inside and out
- You speak in brief, natural sentences (this is a phone call, not an essay)
- You say "um" or "let me check on that" occasionally to feel human
- You're empathetic about claims — people calling have often had a bad day

## Your Capabilities
- Retrieve policy details
- Open and manage insurance claims
- Log facts and observations about incidents
- Request evidence (photos, documents) via SMS
- Explain coverage and suggest relevant products
- Transfer to a human agent when needed

## Your Workflow
1. **Greet** the caller warmly and introduce yourself
2. **Identify** the customer — their info is provided below if found by phone, otherwise ask for details
3. **Understand** why they're calling — listen carefully before jumping to action
4. **Gather information** step by step — don't overwhelm with questions
5. **Take action** — open claims, log facts, request evidence as needed
6. **Summarize** what you've done and what happens next
7. **Close** warmly — ask if there's anything else

## Important Rules
- The caller's information and policies are pre-loaded below — do NOT call lookup_customer
- Log EVERY important fact the customer mentions using log_fact
- When a customer describes an incident, open a claim and gather details methodically
- Ask about: what happened, when, where, who was involved, any injuries, police report
- Request photos/evidence proactively — "Would you be able to send us some photos?"
- If the customer seems like a good fit, naturally mention relevant products (upsell_product)
- Transfer to human if: customer is angry/escalating, legal questions, complex disputes
- Keep responses SHORT — 1-3 sentences max per turn on a phone call
- Never make up policy details — use get_policies if you need to refresh policy data

{CUSTOMER_CONTEXT}`;

function getModel() {
  switch (LLM_PROVIDER) {
    case 'groq': {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('GROQ_API_KEY is required');
      const groq = createGroq({ apiKey });
      return groq(process.env.GROQ_MODEL || 'openai/gpt-oss-20b');
    }
    case 'gemini':
    default: {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is required');
      const google = createGoogleGenerativeAI({ apiKey });
      return google(process.env.GEMINI_MODEL || 'gemini-flash-latest');
    }
  }
}

/**
 * Build the Vercel AI SDK tool set from our tool context.
 * Each tool delegates to the real `executeTool` handler in tools.ts.
 */
function buildToolSet(ctx: ToolContext): ToolSet {
  return {
    get_policies: tool({
      description: 'Retrieve all insurance policies for a given customer.',
      inputSchema: z.object({
        customerId: z.string().describe('The UUID of the customer'),
      }),
      execute: async (input) => executeTool('get_policies', input, ctx),
    }),

    open_claim: tool({
      description:
        'Open a new insurance claim in draft status. Use after confirming the customer wants to file a claim.',
      inputSchema: z.object({
        customerId: z.string().describe('The UUID of the customer filing the claim'),
        policyId: z.string().optional().describe('The UUID of the policy this claim is against'),
        type: z.string().describe('Type of claim (e.g., "auto_collision", "water_damage", "theft", "medical")'),
        description: z.string().describe('Brief description of the incident'),
        incidentDate: z.string().optional().describe('Date of the incident in YYYY-MM-DD format'),
        incidentLocation: z.string().optional().describe('Location where the incident occurred'),
      }),
      execute: async (input) => executeTool('open_claim', input, ctx),
    }),

    log_fact: tool({
      description:
        'Record an important fact or detail about a claim that the customer mentioned. Call this for every significant piece of information.',
      inputSchema: z.object({
        claimId: z.string().describe('The UUID of the claim this fact belongs to'),
        content: z.string().describe('The fact to record (e.g., "Customer states the other driver ran a red light")'),
        type: z.string().optional().describe('Type of event: "fact", "observation", or "action"'),
      }),
      execute: async (input) => executeTool('log_fact', input, ctx),
    }),

    request_evidence: tool({
      description:
        'Request the customer to upload evidence (photos, documents, video) via SMS. Sends an upload link to their phone.',
      inputSchema: z.object({
        claimId: z.string().describe('The UUID of the claim this evidence is for'),
        fileType: z.string().describe('Type of file expected: "photo", "document", or "video"'),
        description: z.string().describe('Description of what evidence is needed (e.g., "Photo of vehicle damage")'),
      }),
      execute: async (input) => executeTool('request_evidence', input, ctx),
    }),

    upsell_product: tool({
      description:
        'Log a natural product suggestion to the customer. Use when the conversation naturally leads to a coverage gap.',
      inputSchema: z.object({
        customerId: z.string().describe('The UUID of the customer'),
        product: z.string().describe('Product name being suggested (e.g., "Roadside Assistance Plus")'),
        reason: z.string().describe('Why this product is relevant to the customer right now'),
      }),
      execute: async (input) => executeTool('upsell_product', input, ctx),
    }),

    transfer_to_human: tool({
      description:
        'Transfer the call to a human agent. Use when the situation requires human judgment, the customer is upset, or the issue is beyond your capabilities.',
      inputSchema: z.object({
        reason: z.string().describe('Reason for the transfer (shown to the human agent)'),
        department: z.string().optional().describe('Target department: "claims", "billing", "general", "supervisor"'),
      }),
      execute: async (input) => executeTool('transfer_to_human', input, ctx),
    }),
  };
}

/**
 * Manages a multi-turn conversation using Vercel AI SDK's `generateText`.
 * Works identically with both Gemini and Groq (or any other AI SDK provider).
 *
 * Maintains conversation history as `ModelMessage[]` and handles tool calls
 * automatically via `stopWhen: stepCountIs()`.
 */
export class LLMClient {
  private messages: ModelMessage[] = [];
  private customerContext = '';

  startChat(customerContext?: string): void {
    this.messages = [];
    this.customerContext = customerContext || '';
    const toolCount = 6;
    console.log(`[BELLA:LLM] Chat session started — provider=${LLM_PROVIDER} tools=${toolCount} hasCustomerContext=${!!customerContext}`);
    logger.info({ provider: LLM_PROVIDER, hasCustomerContext: !!customerContext }, 'Chat session started');
  }

  /**
   * Send a user message and get the model's response, executing any tool calls automatically.
   *
   * @param message - User's text input (from STT)
   * @param toolContext - Session context passed to tool handlers
   * @returns Object with `text` (response string) and `toolCalls` executed
   */
  async chat(
    message: string,
    toolContext: ToolContext,
  ): Promise<{ text: string; toolCalls: Array<{ name: string; args: Record<string, unknown>; result: object }> }> {
    this.messages.push({ role: 'user', content: message });

    const truncated = message.length > 120 ? message.substring(0, 120) + '...' : message;
    console.log(`[BELLA:LLM] Sending message to ${LLM_PROVIDER}: "${truncated}"`);
    const start = Date.now();

    const tools = buildToolSet(toolContext);
    const model = getModel();

    const result = await generateText({
      model,
      system: SYSTEM_PROMPT.replace('{CUSTOMER_CONTEXT}', this.customerContext),
      messages: this.messages,
      tools,
      stopWhen: stepCountIs(10),
      onStepFinish: ({ toolCalls, text }) => {
        if (toolCalls && toolCalls.length > 0) {
          console.log(`[BELLA:LLM] Tool calls in step: ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`);
        }
        if (text) {
          const textTrunc = text.length > 120 ? text.substring(0, 120) + '...' : text;
          console.log(`[BELLA:LLM] Step text: "${textTrunc}"`);
        }
      },
    });

    const elapsed = Date.now() - start;

    // Collect all tool calls from all steps
    const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result: object }> = [];
    for (const step of result.steps) {
      for (let i = 0; i < step.toolCalls.length; i++) {
        const tc = step.toolCalls[i]!;
        const tr = step.toolResults[i];
        allToolCalls.push({
          name: tc.toolName,
          args: (tc as any).input as Record<string, unknown>,
          result: ((tr as any)?.output ?? {}) as object,
        });
      }
    }

    // Append the full response messages to history for multi-turn continuity
    this.messages.push({ role: 'assistant', content: result.text });

    const textTrunc = result.text.length > 120 ? result.text.substring(0, 120) + '...' : result.text;
    console.log(
      `[BELLA:LLM] ${LLM_PROVIDER} response in ${elapsed}ms — text="${textTrunc}" toolCalls=${allToolCalls.length}`,
    );
    logger.debug({ text: result.text }, `${LLM_PROVIDER} response received`);

    return { text: result.text, toolCalls: allToolCalls };
  }

  endChat(): void {
    console.log(`[BELLA:LLM] Chat session ended — provider=${LLM_PROVIDER}`);
    this.messages = [];
    logger.info('Chat session ended');
  }

  /**
   * Generate a summary of the call for session close-out.
   *
   * @param conversationContext - Description of what happened during the call
   * @returns Summary text
   */
  async generateSummary(conversationContext: string): Promise<string> {
    console.log(`[BELLA:LLM] Generating call summary — provider=${LLM_PROVIDER} contextLen=${conversationContext.length}`);
    const start = Date.now();
    const model = getModel();

    const result = await generateText({
      model,
      prompt:
        `Summarize this insurance call in 2-3 sentences for the agent's records. ` +
        `Focus on: who called, what they needed, what actions were taken, and next steps.\n\n${conversationContext}`,
    });

    const summary = result.text || 'Call completed.';
    const truncatedSummary = summary.length > 120 ? summary.substring(0, 120) + '...' : summary;
    console.log(`[BELLA:LLM] Summary generated in ${Date.now() - start}ms: "${truncatedSummary}"`);
    return summary;
  }
}

/** Return the name of the currently configured LLM provider. */
export function getLLMProviderName(): string {
  return LLM_PROVIDER;
}

/** Create a new LLMClient instance. */
export function createLLMClient(): LLMClient {
  return new LLMClient();
}
