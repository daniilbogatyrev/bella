import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { generateStreamTwiML } from './twilio';
import { SessionManager } from './session';
import { getSTTProviderName } from './stt';
import { getLLMProviderName } from './llm';

const { upgradeWebSocket, websocket } = createBunWebSocket();

const sessionManager = new SessionManager();
const app = new Hono();

app.use('*', async (c, next) => {
  console.log(`[BELLA:HTTP] ${c.req.method} ${c.req.url}`);
  await next();
});

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'bella-ws-server',
    activeSessions: sessionManager.getActiveSessions().length,
    uptime: process.uptime(),
  });
});

app.post('/inbound/twiml', async (c) => {
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.WS_SERVER_PORT || 8080}`;
  const wsUrl = publicUrl.replace('https://', 'wss://').replace('http://', 'ws://');
  const wsStreamUrl = `${wsUrl}/ws/stream`;

  const body = await c.req.parseBody();
  const callerPhone = (body['From'] as string) || (body['Caller'] as string)
    || c.req.query('From') || c.req.query('Caller') || 'unknown';
  const callSid = (body['CallSid'] as string) || c.req.query('CallSid') || 'unknown';

  console.log(`[BELLA:HTTP] /inbound/twiml hit — callerPhone=${callerPhone} callSid=${callSid} wsStreamUrl=${wsStreamUrl}`);
  const twiml = generateStreamTwiML(wsStreamUrl, callerPhone);
  console.log(`[BELLA:HTTP] TwiML response:\n${twiml}`);

  return c.text(twiml, 200, { 'Content-Type': 'application/xml' });
});

app.get(
  '/ws/stream',
  upgradeWebSocket(() => {
    let callSid = '';

    return {
      onOpen(_event, ws) {
        console.log('[BELLA:WS] New WebSocket connection from Twilio');
        void ws;
      },

      onMessage(event, ws) {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();

        if (!callSid) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.event === 'start' && parsed.start?.callSid) {
              callSid = parsed.start.callSid;
              console.log(`[BELLA:WS] Start event received — callSid=${callSid}`);
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
          console.log(`[BELLA:WS] WebSocket connection closed — callSid=${callSid}`);
          sessionManager.endSession(callSid);
        }
      },

      onError(event) {
        console.error(`[BELLA:WS] WebSocket error — callSid=${callSid}`, event);
        if (callSid) {
          sessionManager.endSession(callSid);
        }
      },
    };
  }),
);

const port = Number(process.env.PORT) || 8080;

console.log(`🔔 Bella WS Server starting on port ${port}`);
console.log(`[BELLA:CONFIG] STT provider: ${getSTTProviderName()}`);
console.log(`[BELLA:CONFIG] LLM provider: ${getLLMProviderName()}`);
const ttsProvider = process.env.TTS_PROVIDER || 'gradium';
console.log(`[BELLA:CONFIG] TTS provider: ${ttsProvider}`);
const bgEnabled = process.env.BG_NOISE_ENABLED !== 'false';
const bgGain = parseFloat(process.env.BG_NOISE_GAIN || '0.04') || 0.04;
console.log(`[BELLA:CONFIG] Background noise: ${bgEnabled ? 'enabled' : 'disabled'} (gain=${bgGain})`);

export { app, sessionManager };

export default {
  port,
  fetch: app.fetch,
  websocket,
};
