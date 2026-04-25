import { describe, it, expect } from 'bun:test';
import { getAvailableTools, executeTool, type ToolContext } from '../../tools';

const REQUIRED_TOOLS = [
  'lookup_customer',
  'get_policies',
  'open_claim',
  'log_fact',
  'request_evidence',
  'upsell_product',
  'transfer_to_human',
] as const;

describe('Integration: Agent Tools', () => {
  const ctx: ToolContext = {
    sessionId: 'test-integration-session',
    callerPhone: '+15551234567',
  };

  it('has all 7 required tools', () => {
    const tools = getAvailableTools();
    for (const name of REQUIRED_TOOLS) {
      expect(tools).toContain(name);
    }
    expect(tools.length).toBe(7);
  });

  it('returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', {}, ctx);
    expect(result).toHaveProperty('error', true);
    expect((result as { message: string }).message).toContain('Unknown tool');
  });

  it('transfer_to_human returns transferred status without DB', async () => {
    const result = await executeTool('transfer_to_human', { reason: 'Test transfer' }, ctx);
    expect(result).toHaveProperty('transferred', true);
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('department', 'general');
  });

  it('transfer_to_human accepts custom department', async () => {
    const result = await executeTool(
      'transfer_to_human',
      { reason: 'Billing question', department: 'billing' },
      ctx,
    );
    expect(result).toHaveProperty('transferred', true);
    expect(result).toHaveProperty('department', 'billing');
  });

  it('upsell_product works without active claim', async () => {
    const result = await executeTool(
      'upsell_product',
      { customerId: 'test-customer', product: 'Roadside Plus', reason: 'Frequent driver' },
      ctx,
    );
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('product', 'Roadside Plus');
  });

  it('DB-dependent tools fail gracefully without DATABASE_URL', async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const result = await executeTool('lookup_customer', { phone: '+15551234567' }, ctx);
      expect(result).toHaveProperty('error', true);
      expect((result as { message: string }).message).toContain('failed');
    } finally {
      if (originalUrl) {
        process.env.DATABASE_URL = originalUrl;
      }
    }
  });

  it('all tool names are non-empty strings', () => {
    const tools = getAvailableTools();
    for (const tool of tools) {
      expect(typeof tool).toBe('string');
      expect(tool.length).toBeGreaterThan(0);
      expect(tool).toMatch(/^[a-z_]+$/);
    }
  });
});
