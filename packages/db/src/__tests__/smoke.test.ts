import { describe, it, expect } from 'bun:test';

describe('DB Package', () => {
  it('exports getDb function', async () => {
    const mod = await import('../index');
    expect(typeof mod.getDb).toBe('function');
  });

  it('getDb throws without DATABASE_URL', () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { getDb } = require('../client');
      expect(() => getDb()).toThrow('DATABASE_URL');
    } finally {
      if (originalUrl) process.env.DATABASE_URL = originalUrl;
    }
  });
});
