import { describe, it, expect, beforeEach } from 'bun:test';
import { SchemaType } from '@google/generative-ai';
import {
  SYSTEM_PROMPT,
  TOOL_DECLARATIONS,
  GeminiClient,
  getGeminiClient,
  resetGeminiClient,
} from '../llm';

describe('LLM (Gemini)', () => {
  describe('SYSTEM_PROMPT', () => {
    it('is a non-empty string', () => {
      expect(typeof SYSTEM_PROMPT).toBe('string');
      expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it('describes Bella as a friendly insurance agent', () => {
      expect(SYSTEM_PROMPT).toContain('Bella');
      expect(SYSTEM_PROMPT).toContain('insurance');
      expect(SYSTEM_PROMPT).toContain('friendly');
      expect(SYSTEM_PROMPT).toContain('empathetic');
    });

    it('mentions identity confirmation', () => {
      expect(SYSTEM_PROMPT).toContain('Identify');
    });

    it('instructs to use lookup_customer', () => {
      expect(SYSTEM_PROMPT).toContain('lookup_customer');
    });

    it('instructs to log facts', () => {
      expect(SYSTEM_PROMPT).toContain('log_fact');
    });

    it('instructs to keep responses short for phone calls', () => {
      expect(SYSTEM_PROMPT).toContain('SHORT');
    });

    it('mentions transfer to human for edge cases', () => {
      expect(SYSTEM_PROMPT).toContain('Transfer to human');
    });
  });

  describe('TOOL_DECLARATIONS', () => {
    it('contains exactly 7 tool declarations', () => {
      expect(TOOL_DECLARATIONS).toHaveLength(7);
    });

    it('includes all required tools', () => {
      const toolNames = TOOL_DECLARATIONS.map((t) => t.name);
      expect(toolNames).toContain('lookup_customer');
      expect(toolNames).toContain('get_policies');
      expect(toolNames).toContain('open_claim');
      expect(toolNames).toContain('log_fact');
      expect(toolNames).toContain('request_evidence');
      expect(toolNames).toContain('upsell_product');
      expect(toolNames).toContain('transfer_to_human');
    });

    it('every tool has a name, description, and parameters', () => {
      for (const tool of TOOL_DECLARATIONS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters!.type).toBe(SchemaType.OBJECT);
        expect(tool.parameters!.properties).toBeDefined();
      }
    });

    it('every tool has at least one required parameter', () => {
      for (const tool of TOOL_DECLARATIONS) {
        expect(tool.parameters!.required).toBeDefined();
        expect(tool.parameters!.required!.length).toBeGreaterThan(0);
      }
    });

    it('lookup_customer requires phone', () => {
      const tool = TOOL_DECLARATIONS.find((t) => t.name === 'lookup_customer')!;
      expect(tool.parameters!.required).toContain('phone');
    });

    it('open_claim requires customerId, type, and description', () => {
      const tool = TOOL_DECLARATIONS.find((t) => t.name === 'open_claim')!;
      expect(tool.parameters!.required).toContain('customerId');
      expect(tool.parameters!.required).toContain('type');
      expect(tool.parameters!.required).toContain('description');
    });

    it('request_evidence requires claimId, fileType, and description', () => {
      const tool = TOOL_DECLARATIONS.find((t) => t.name === 'request_evidence')!;
      expect(tool.parameters!.required).toContain('claimId');
      expect(tool.parameters!.required).toContain('fileType');
      expect(tool.parameters!.required).toContain('description');
    });
  });

  describe('GeminiClient', () => {
    it('class exists', () => {
      expect(GeminiClient).toBeDefined();
      expect(typeof GeminiClient).toBe('function');
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      resetGeminiClient();
      delete process.env.GEMINI_API_KEY;
    });

    it('throws when GEMINI_API_KEY is not set', () => {
      expect(() => getGeminiClient()).toThrow('GEMINI_API_KEY is required');
    });

    it('returns a GeminiClient when API key is set', () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const client = getGeminiClient();
      expect(client).toBeInstanceOf(GeminiClient);
    });
  });
});
