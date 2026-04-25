import { describe, it, expect, beforeEach } from 'bun:test';
import {
  SYSTEM_PROMPT,
  LLMClient,
  createLLMClient,
  getLLMProviderName,
} from '../llm';

describe('LLM', () => {
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

    it('instructs not to call lookup_customer', () => {
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

  describe('LLMClient', () => {
    it('class exists', () => {
      expect(LLMClient).toBeDefined();
      expect(typeof LLMClient).toBe('function');
    });

    it('createLLMClient returns an LLMClient', () => {
      const client = createLLMClient();
      expect(client).toBeInstanceOf(LLMClient);
    });
  });

  describe('getLLMProviderName', () => {
    it('returns the configured provider name', () => {
      const name = getLLMProviderName();
      expect(['gemini', 'groq']).toContain(name);
    });
  });
});
