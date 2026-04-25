import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { generateStreamTwiML } from './twilio';
import { SessionManager } from './session';

const { upgradeWebSocket, websocket } = createBunWebSocket();

const sessionManager = new SessionManager();
const app = new Hono();

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'bella-ws-server',
    activeSessions: sessionManager.getActiveSessions().length,
    uptime: process.uptime(),
  });
});

app.post('/inbound/twiml', (c) => {
  const wsPublicUrl = process.env.WS_SERVER_PUBLIC_URL || 'wss://localhost:8080';
  const wsStreamUrl = `${wsPublicUrl}/ws/stream`;
  const callerPhone = c.req.query('From') || c.req.query('Caller') || 'unknown';
  const twiml = generateStreamTwiML(wsStreamUrl, callerPhone);

  return c.text(twiml, 200, { 'Content-Type': 'application/xml' });
});

app.get(
  '/ws/stream',
  upgradeWebSocket(() => {
    let callSid = '';

    return {
      onOpen(_event, ws) {
        console.log('[ws] New WebSocket connection');
        void ws;
      },

      onMessage(event, ws) {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();

        if (!callSid) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.event === 'start' && parsed.start?.callSid) {
              callSid = parsed.start.callSid;
              const rawWs = ws.raw as unknown as { send: (data: string) => void };
              sessionManager.createSession(callSid, rawWs);
            }
          } catch {
            // Not a start message yet, wait
          }
        }

        if (callSid) {
          sessionManager.handleTwilioMessage(callSid, raw);
        }
      },

      onClose() {
        if (callSid) {
          console.log(`[ws] Connection closed for call ${callSid}`);
          sessionManager.endSession(callSid);
        }
      },

      onError(event) {
        console.error('[ws] WebSocket error:', event);
        if (callSid) {
          sessionManager.endSession(callSid);
        }
      },
    };
  }),
);

const port = Number(process.env.PORT) || 8080;

console.log(`🔔 Bella WS Server starting on port ${port}`);

export { app, sessionManager };

export default {
  port,
  fetch: app.fetch,
  websocket,
};
