import { describe, it, expect } from 'bun:test';
import { getAvailableTools, executeTool, type ToolContext } from '../tools';

describe('Tools', () => {
  describe('getAvailableTools', () => {
    it('returns an array of 6 tool names', () => {
      const tools = getAvailableTools();
      expect(tools).toHaveLength(6);
    });

    it('includes all required tool names', () => {
      const tools = getAvailableTools();
      expect(tools).toContain('get_policies');
      expect(tools).toContain('open_claim');
      expect(tools).toContain('log_fact');
      expect(tools).toContain('request_evidence');
      expect(tools).toContain('upsell_product');
      expect(tools).toContain('transfer_to_human');
    });

    it('returns string array', () => {
      const tools = getAvailableTools();
      for (const tool of tools) {
        expect(typeof tool).toBe('string');
      }
    });
  });

  describe('executeTool', () => {
    const ctx: ToolContext = {
      sessionId: 'test-session-id',
      callerPhone: '+15551234567',
    };

    it('returns error for unknown tool', async () => {
      const result = await executeTool('nonexistent_tool', {}, ctx);
      expect(result).toHaveProperty('error', true);
      expect(result).toHaveProperty('message');
      expect((result as { message: string }).message).toContain('Unknown tool');
    });

    it('returns error for empty tool name', async () => {
      const result = await executeTool('', {}, ctx);
      expect(result).toHaveProperty('error', true);
    });

    it('handles DB errors gracefully (no DATABASE_URL)', async () => {
      const originalUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        const result = await executeTool('get_policies', { customerId: 'test-id' }, ctx);
        expect(result).toHaveProperty('error', true);
        expect((result as { message: string }).message).toContain('failed');
      } finally {
        if (originalUrl) {
          process.env.DATABASE_URL = originalUrl;
        }
      }
    });

    it('executeTool is a function', () => {
      expect(typeof executeTool).toBe('function');
    });
  });
});
