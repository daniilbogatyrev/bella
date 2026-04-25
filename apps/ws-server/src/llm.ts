import {
  GoogleGenerativeAI,
  SchemaType,
  type ChatSession,
  type FunctionDeclaration,
  type GenerativeModel,
} from '@google/generative-ai';
import pino from 'pino';

const logger = pino({ name: 'bella-llm' });

export const SYSTEM_PROMPT = `You are Bella, a friendly and empathetic AI insurance agent for SafeGuard Insurance.

## Your Personality
- Warm, professional, and patient — like a helpful neighbor who happens to know insurance inside and out
- You speak in brief, natural sentences (this is a phone call, not an essay)
- You say "um" or "let me check on that" occasionally to feel human
- You're empathetic about claims — people calling have often had a bad day

## Your Capabilities
- Look up customers by their phone number
- Retrieve policy details
- Open and manage insurance claims
- Log facts and observations about incidents
- Request evidence (photos, documents) via SMS
- Explain coverage and suggest relevant products
- Transfer to a human agent when needed

## Your Workflow
1. **Greet** the caller warmly and introduce yourself
2. **Identify** the customer — ask to confirm their name if found by phone, or ask for details
3. **Understand** why they're calling — listen carefully before jumping to action
4. **Gather information** step by step — don't overwhelm with questions
5. **Take action** — open claims, log facts, request evidence as needed
6. **Summarize** what you've done and what happens next
7. **Close** warmly — ask if there's anything else

## Important Rules
- ALWAYS use lookup_customer first when starting a call
- Log EVERY important fact the customer mentions using log_fact
- When a customer describes an incident, open a claim and gather details methodically
- Ask about: what happened, when, where, who was involved, any injuries, police report
- Request photos/evidence proactively — "Would you be able to send us some photos?"
- If the customer seems like a good fit, naturally mention relevant products (upsell_product)
- Transfer to human if: customer is angry/escalating, legal questions, complex disputes
- Keep responses SHORT — 1-3 sentences max per turn on a phone call
- Never make up policy details — always use get_policies to check`;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'lookup_customer',
    description:
      'Look up a customer by their phone number. Returns customer profile and associated policies if found.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        phone: {
          type: SchemaType.STRING,
          description: 'Phone number in E.164 format (e.g., +15551234567)',
        },
      },
      required: ['phone'],
    },
  },
  {
    name: 'get_policies',
    description: 'Retrieve all insurance policies for a given customer.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customerId: {
          type: SchemaType.STRING,
          description: 'The UUID of the customer',
        },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'open_claim',
    description:
      'Open a new insurance claim in draft status. Use after confirming the customer wants to file a claim.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customerId: {
          type: SchemaType.STRING,
          description: 'The UUID of the customer filing the claim',
        },
        policyId: {
          type: SchemaType.STRING,
          description: 'The UUID of the policy this claim is against',
        },
        type: {
          type: SchemaType.STRING,
          description:
            'Type of claim (e.g., "auto_collision", "water_damage", "theft", "medical")',
        },
        description: {
          type: SchemaType.STRING,
          description: 'Brief description of the incident',
        },
        incidentDate: {
          type: SchemaType.STRING,
          description: 'Date of the incident in YYYY-MM-DD format',
        },
        incidentLocation: {
          type: SchemaType.STRING,
          description: 'Location where the incident occurred',
        },
      },
      required: ['customerId', 'type', 'description'],
    },
  },
  {
    name: 'log_fact',
    description:
      'Record an important fact or detail about a claim that the customer mentioned. Call this for every significant piece of information.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        claimId: {
          type: SchemaType.STRING,
          description: 'The UUID of the claim this fact belongs to',
        },
        content: {
          type: SchemaType.STRING,
          description: 'The fact to record (e.g., "Customer states the other driver ran a red light")',
        },
        type: {
          type: SchemaType.STRING,
          description: 'Type of event: "fact", "observation", or "action"',
        },
      },
      required: ['claimId', 'content'],
    },
  },
  {
    name: 'request_evidence',
    description:
      'Request the customer to upload evidence (photos, documents, video) via SMS. Sends an upload link to their phone.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        claimId: {
          type: SchemaType.STRING,
          description: 'The UUID of the claim this evidence is for',
        },
        fileType: {
          type: SchemaType.STRING,
          description: 'Type of file expected: "photo", "document", or "video"',
        },
        description: {
          type: SchemaType.STRING,
          description: 'Description of what evidence is needed (e.g., "Photo of vehicle damage")',
        },
      },
      required: ['claimId', 'fileType', 'description'],
    },
  },
  {
    name: 'upsell_product',
    description:
      'Log a natural product suggestion to the customer. Use when the conversation naturally leads to a coverage gap.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        customerId: {
          type: SchemaType.STRING,
          description: 'The UUID of the customer',
        },
        product: {
          type: SchemaType.STRING,
          description: 'Product name being suggested (e.g., "Roadside Assistance Plus")',
        },
        reason: {
          type: SchemaType.STRING,
          description: 'Why this product is relevant to the customer right now',
        },
      },
      required: ['customerId', 'product', 'reason'],
    },
  },
  {
    name: 'transfer_to_human',
    description:
      'Transfer the call to a human agent. Use when the situation requires human judgment, the customer is upset, or the issue is beyond your capabilities.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reason: {
          type: SchemaType.STRING,
          description: 'Reason for the transfer (shown to the human agent)',
        },
        department: {
          type: SchemaType.STRING,
          description: 'Target department: "claims", "billing", "general", "supervisor"',
        },
      },
      required: ['reason'],
    },
  },
];

/**
 * Wrapper around the Google Generative AI ChatSession that manages
 * Bella's conversation lifecycle with tool calling support.
 *
 * @example
 * ```ts
 * const client = new GeminiClient(model);
 * const chat = client.startChat();
 * const response = await client.chat('Hi, I was in a car accident');
 * ```
 */
export class GeminiClient {
  private model: GenerativeModel;
  private chatSession: ChatSession | null = null;

  constructor(model: GenerativeModel) {
    this.model = model;
  }

  /** Start a new chat session with Bella's system prompt and tool declarations. */
  startChat(): ChatSession {
    this.chatSession = this.model.startChat({
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    });
    logger.info('Gemini chat session started');
    return this.chatSession;
  }

  /**
   * Send a user message and get the model's response.
   *
   * @param message - User's text input (from STT)
   * @returns The model's response, which may include text and/or function calls
   */
  async chat(message: string) {
    if (!this.chatSession) {
      this.startChat();
    }
    const result = await this.chatSession!.sendMessage(message);
    const response = result.response;
    logger.debug({ text: response.text?.() }, 'Gemini response received');
    return response;
  }

  /**
   * Send function execution results back to the model for continued reasoning.
   *
   * @param results - Array of function name + response object pairs
   * @returns The model's follow-up response
   */
  async sendToolResults(results: Array<{ name: string; response: object }>) {
    if (!this.chatSession) {
      throw new Error('No active chat session');
    }
    const functionResponseParts = results.map((r) => ({
      functionResponse: { name: r.name, response: r.response },
    }));
    const result = await this.chatSession.sendMessage(functionResponseParts);
    const response = result.response;
    logger.debug({ text: response.text?.() }, 'Gemini tool result response');
    return response;
  }

  /** End the chat session. */
  endChat(): void {
    this.chatSession = null;
    logger.info('Gemini chat session ended');
  }

  /**
   * Generate a summary of the call for session close-out.
   *
   * @param conversationContext - Description of what happened during the call
   * @returns Summary text
   */
  async generateSummary(conversationContext: string): Promise<string> {
    const result = await this.model.generateContent(
      `Summarize this insurance call in 2-3 sentences for the agent's records. ` +
        `Focus on: who called, what they needed, what actions were taken, and next steps.\n\n${conversationContext}`,
    );
    return result.response.text() || 'Call completed.';
  }
}

let genAI: GoogleGenerativeAI | null = null;

/**
 * Get or create the singleton GeminiClient with Bella's model configuration.
 *
 * @throws Error if GEMINI_API_KEY environment variable is not set
 */
export function getGeminiClient(): GeminiClient {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    genAI = new GoogleGenerativeAI(apiKey);
  }

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  });

  return new GeminiClient(model);
}

/** Reset the singleton (for testing). */
export function resetGeminiClient(): void {
  genAI = null;
}
