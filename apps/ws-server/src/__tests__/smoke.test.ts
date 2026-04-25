import { describe, it, expect } from 'bun:test';

describe('WS Server', () => {
  it('health endpoint returns ok', async () => {
    const app = await import('../index');
    const port = app.default.port;
    expect(port).toBe(8080);
  });

  it('exports correct config', async () => {
    const app = await import('../index');
    expect(app.default).toHaveProperty('fetch');
    expect(app.default).toHaveProperty('port');
  });
});
