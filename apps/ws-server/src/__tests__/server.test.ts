import { describe, it, expect } from 'bun:test';
import { app } from '../index';

describe('WS Server HTTP Endpoints', () => {
  describe('GET /health', () => {
    it('returns status ok with service name', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('bella-ws-server');
      expect(typeof body.activeSessions).toBe('number');
      expect(typeof body.uptime).toBe('number');
    });
  });

  describe('POST /inbound/twiml', () => {
    it('returns TwiML XML response', async () => {
      const res = await app.request('/inbound/twiml', { method: 'POST' });
      expect(res.status).toBe(200);

      const contentType = res.headers.get('Content-Type');
      expect(contentType).toContain('application/xml');

      const body = await res.text();
      expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(body).toContain('<Response>');
      expect(body).toContain('<Connect>');
      expect(body).toContain('<Stream');
      expect(body).toContain('/ws/stream');
    });

    it('includes caller phone from query param', async () => {
      const res = await app.request('/inbound/twiml?From=%2B15551234567', { method: 'POST' });
      const body = await res.text();
      expect(body).toContain('+15551234567');
    });

    it('handles missing caller phone gracefully', async () => {
      const res = await app.request('/inbound/twiml', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('unknown');
    });
  });

  describe('GET /ws/stream', () => {
    it('returns 426 without upgrade header (not a WS handshake)', async () => {
      const res = await app.request('/ws/stream');
      // Without proper upgrade headers, Hono returns an error
      expect(res.status).not.toBe(200);
    });
  });

  describe('Non-existent routes', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('Server config', () => {
    it('exports correct default config', async () => {
      const mod = await import('../index');
      expect(mod.default.port).toBe(8080);
      expect(mod.default.fetch).toBeDefined();
      expect(mod.default.websocket).toBeDefined();
    });

    it('exports sessionManager', async () => {
      const mod = await import('../index');
      expect(mod.sessionManager).toBeDefined();
      expect(typeof mod.sessionManager.getActiveSessions).toBe('function');
    });
  });
});
