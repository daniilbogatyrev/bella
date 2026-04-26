import { Hono, type Context } from "hono";
import pino from "pino";
import {
  createSession,
  getSession,
  handleTwilioMessage,
  closeSession,
} from "./session.ts";
import { createModel } from "./llm.ts";
import { ConversationalAISession } from "./conversational-ai.ts";
import { updateCallSessionPhone, findCustomerByPhone } from "./db.ts";
import type { ServerWebSocket } from "bun";

const logger = pino({ name: "bella-server" });

const app = new Hono();
const PORT = Number(process.env.PORT) || 8080;

const PIPELINE_MODE = process.env.PIPELINE_MODE || 'classic';
console.log(`[BELLA:CONFIG] Pipeline mode: ${PIPELINE_MODE}`);

/** Pipeline mode: "classic" (STT → LLM → TTS) or "conversational_ai" (ElevenLabs all-in-one) */
const pipelineMode = PIPELINE_MODE.toLowerCase() === "conversational_ai"
  ? "conversational_ai"
  : "classic";

const ttsProvider = process.env.TTS_PROVIDER?.toLowerCase() === "elevenlabs"
  ? "elevenlabs"
  : "gradium";

const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID ?? "";

logger.info(`[BELLA:CONFIG] Pipeline mode: ${pipelineMode}`);
logger.info(`[BELLA:CONFIG] TTS provider: ${ttsProvider} (used in classic mode)`);

if (pipelineMode === "conversational_ai") {
  if (!ELEVENLABS_AGENT_ID) {
    logger.error("[BELLA:CONFIG] ELEVENLABS_AGENT_ID is required for conversational_ai mode. Run: bun run src/setup-agent.ts");
    process.exit(1);
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    logger.error("[BELLA:CONFIG] ELEVENLABS_API_KEY is required for conversational_ai mode");
    process.exit(1);
  }
  logger.info({ agentId: ELEVENLABS_AGENT_ID }, "[BELLA:CONFIG] ElevenLabs Agent ID configured");
}

if (pipelineMode === "classic") {
  createModel();
}

/** Health check */
app.get("/health", (c) => c.json({ status: "ok", pipelineMode, ttsProvider }));

/** Build TwiML that tells Twilio to open a bidirectional media stream */
async function buildTwimlResponse(c: Context) {
  const host = c.req.header("host") ?? "localhost";
  const wsUrl = `wss://${host}/media-stream`;

  let callerPhone = "";
  try {
    const contentType = c.req.header("content-type") ?? "";
    console.log("[BELLA:TWIML] Content-Type:", contentType);

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const rawBody = await c.req.text();
      console.log("[BELLA:TWIML] Raw body:", rawBody);
      const params = new URLSearchParams(rawBody);
      callerPhone = params.get("From") ?? params.get("Caller") ?? "";
    } else {
      const body = await c.req.parseBody();
      console.log("[BELLA:TWIML] Parsed body:", JSON.stringify(body));
      callerPhone = (body.From as string) ?? (body.Caller as string) ?? "";
    }

    console.log("[BELLA:TWIML] Extracted caller phone:", callerPhone);
  } catch (err) {
    console.error("[BELLA:TWIML] Failed to parse Twilio body:", err);
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${callerPhone}" />
    </Stream>
  </Connect>
</Response>`;

  console.log("[BELLA:TWIML] Responding with TwiML, callerPhone:", callerPhone);
  return c.text(twiml, 200, { "Content-Type": "text/xml" });
}

app.post("/voice", (c) => buildTwimlResponse(c));
app.post("/inbound/twiml", (c) => buildTwimlResponse(c));

logger.info({ port: PORT }, "[BELLA:SERVER] Starting Bella voice agent");

/** Per-call ConversationalAI sessions, keyed by callId */
const convAISessions = new Map<string, ConversationalAISession>();

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const callId = crypto.randomUUID();
      const ok = server.upgrade(req, { data: { callId } });
      if (!ok) {
        logger.error({ path: url.pathname }, "[BELLA:WS] WebSocket upgrade failed");
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      logger.info({ callId, path: url.pathname }, "[BELLA:WS] WebSocket upgrade accepted");
      return undefined;
    }

    return app.fetch(req, server);
  },
  websocket: {
    open(ws: ServerWebSocket<{ callId: string }>) {
      const { callId } = ws.data;
      createSession(callId, ws as unknown as ServerWebSocket<unknown>);
      logger.info({ callId }, "[BELLA:WS] Client connected");
    },

    message(ws: ServerWebSocket<{ callId: string }>, data: string | Buffer) {
      const raw = typeof data === "string" ? data : data.toString();
      const { callId } = ws.data;

      if (pipelineMode === "conversational_ai") {
        handleConvAIMessage(callId, raw, ws as unknown as ServerWebSocket<unknown>);
      } else {
        handleTwilioMessage(callId, raw);
      }
    },

    close(ws: ServerWebSocket<{ callId: string }>) {
      const { callId } = ws.data;

      const convAI = convAISessions.get(callId);
      if (convAI) {
        const session = getSession(callId);
        if (session) {
          const summary = convAI.buildSummary();
          if (summary) {
            session.callSummary = summary;
          }
        }
        convAI.close();
        convAISessions.delete(callId);
      }

      const session = getSession(callId);
      if (session) {
        closeSession(session);
      }
      logger.info({ callId }, "[BELLA:WS] Client disconnected");
    },
  },
});

/**
 * Handle Twilio WebSocket messages in conversational_ai pipeline mode.
 *
 * Routes Twilio events to the ConversationalAISession:
 * - `start` → create and connect ConversationalAISession
 * - `media` → forward audio chunks
 * - `stop`/`close` → tear down
 */
async function handleConvAIMessage(
  callId: string,
  data: string,
  twilioWs: ServerWebSocket<unknown>,
): Promise<void> {
  const session = getSession(callId);
  if (!session) {
    logger.warn({ callId }, "[BELLA:CONVAI] Message for unknown session");
    return;
  }

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    session.logger.warn("[BELLA:CONVAI] Invalid JSON from Twilio");
    return;
  }

  const event = msg.event as string;

  switch (event) {
    case "start": {
      const start = msg.start as {
        streamSid: string;
        callSid: string;
        customParameters?: Record<string, string>;
      };
      session.streamSid = start.streamSid;

      // Extract caller phone from Twilio custom parameters
      let callerPhone = start.customParameters?.from
        ?? start.customParameters?.From
        ?? start.customParameters?.caller
        ?? null;

      session.logger.info(
        { callerPhone, customParameters: start.customParameters, callSid: start.callSid },
        "[BELLA:CONVAI] Initial phone extraction from customParameters",
      );

      // Fallback: look up phone via Twilio REST API using callSid
      if (!callerPhone && start.callSid) {
        try {
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const apiKeySid = process.env.TWILIO_API_KEY_SID;
          const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

          if (accountSid && apiKeySid && apiKeySecret) {
            const auth = Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64");
            const res = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${start.callSid}.json`,
              { headers: { Authorization: `Basic ${auth}` } },
            );
            if (res.ok) {
              const callData = (await res.json()) as { from?: string };
              if (callData.from) {
                callerPhone = callData.from;
                session.logger.info({ callerPhone, source: "twilio-api" }, "[BELLA:CONVAI] Phone from Twilio API fallback");
              }
            } else {
              session.logger.warn({ status: res.status }, "[BELLA:CONVAI] Twilio API call lookup returned non-OK");
            }
          } else {
            session.logger.warn("[BELLA:CONVAI] Twilio API credentials not configured — skipping phone fallback");
          }
        } catch (err) {
          session.logger.error({ err }, "[BELLA:CONVAI] Twilio API phone lookup failed");
        }
      }

      if (callerPhone) {
        session.callerPhone = callerPhone;
        updateCallSessionPhone(callId, callerPhone).catch((err) => {
          session.logger.error({ err }, "[BELLA:CONVAI] Failed to update caller phone in DB");
        });
        session.logger.info({ callerPhone }, "[BELLA:CONVAI] Caller phone captured");

        // Look up customer by phone and set context
        findCustomerByPhone(callerPhone).then((customer) => {
          if (customer) {
            session.customer = customer as unknown as typeof session.customer;
            session.logger.info(
              { customerId: customer.id, name: `${customer.firstName} ${customer.lastName}` },
              "[BELLA:CONVAI] Customer identified from phone",
            );
          }
        }).catch((err) => {
          session.logger.error({ err }, "[BELLA:CONVAI] Customer lookup failed");
        });
      }

      session.logger.info(
        { streamSid: start.streamSid, callerPhone },
        "[BELLA:CONVAI] Twilio stream started — connecting to ElevenLabs ConvAI",
      );

      const convAI = new ConversationalAISession(
        session,
        start.streamSid,
        twilioWs,
        ELEVENLABS_AGENT_ID,
      );

      try {
        await convAI.connect();
        convAISessions.set(callId, convAI);
        session.logger.info("[BELLA:CONVAI] Pipeline ready");
      } catch (err) {
        session.logger.error(
          { err },
          "[BELLA:CONVAI] Failed to connect to ElevenLabs — closing session",
        );
        closeSession(session);
      }
      break;
    }

    case "media": {
      const media = msg.media as { payload: string; timestamp: string };
      const convAI = convAISessions.get(callId);
      if (convAI) {
        convAI.sendAudio(media.payload);
      }
      break;
    }

    case "mark": {
      // In ConvAI mode we don't track marks for end-of-call sequencing
      // since ElevenLabs handles turn-taking internally
      break;
    }

    case "stop":
    case "close": {
      session.logger.info({ event }, "[BELLA:CONVAI] Twilio stream ended");
      const convAI = convAISessions.get(callId);
      if (convAI) {
        const summary = convAI.buildSummary();
        if (summary) {
          session.callSummary = summary;
        }
        convAI.close();
        convAISessions.delete(callId);
      }
      closeSession(session);
      break;
    }

    default:
      session.logger.debug({ event }, "[BELLA:CONVAI] Unhandled Twilio event");
  }
}

logger.info(
  { url: `http://localhost:${server.port}` },
  "[BELLA:SERVER] Bella voice agent running",
);
