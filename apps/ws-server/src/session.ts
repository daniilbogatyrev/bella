import type { ServerWebSocket } from "bun";
import pino from "pino";
import type { Session, Customer, Policy, AudioQueueItem, TTSStream } from "./types.ts";
import { getSystemPrompt, processToolCalls, TOOL_DEFINITIONS } from "./llm.ts";
import { ElevenLabsTTSStream } from "./elevenlabs-tts.ts";
import { GradiumTTSStream } from "./gradium-tts.ts";
import { completeCallSession, createCallSession } from "./db.ts";

const logger = pino({ name: "bella-session" });

const AUDIO_QUEUE_INTERVAL_MS = 200;
const MAX_CALL_DURATION_MS = 540_000; // 9 minutes

/**
 * Create a TTS stream based on the `TTS_PROVIDER` environment variable.
 *
 * @returns `ElevenLabsTTSStream` when `TTS_PROVIDER=elevenlabs`,
 *          `GradiumTTSStream` otherwise (default).
 */
export function createTTSStream(): TTSStream {
  const provider = process.env.TTS_PROVIDER?.toLowerCase();

  if (provider === "elevenlabs") {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      logger.warn("[BELLA:CONFIG] ELEVENLABS_API_KEY not set — falling back to Gradium");
      return createGradiumStream();
    }
    logger.info("[BELLA:CONFIG] TTS provider: elevenlabs");
    return new ElevenLabsTTSStream({
      apiKey,
      model: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2",
    });
  }

  logger.info("[BELLA:CONFIG] TTS provider: gradium");
  return createGradiumStream();
}

function createGradiumStream(): GradiumTTSStream {
  return new GradiumTTSStream({
    apiKey: process.env.GRADIUM_API_KEY ?? "",
    voiceId: process.env.GRADIUM_VOICE_ID,
  });
}

/** In-memory session store keyed by callId */
const sessions = new Map<string, Session>();

/**
 * Create a new call session and start the audio queue processor.
 *
 * @param callId - Twilio CallSid
 * @param ws - WebSocket connection to Twilio
 * @returns The newly created session
 */
export function createSession(
  callId: string,
  ws: ServerWebSocket<unknown>,
): Session {
  const sessionLogger = logger.child({ callId });

  const session: Session = {
    callId,
    streamSid: undefined,
    twilioWs: ws,
    sendQueue: [],
    sendQueueInterval: undefined,
    assistantState: "idle",
    sequenceNumber: 0,
    lastSeqNumber: 0,
    shouldCloseAfterMark: false,
    endCallRequested: false,
    alreadyClosing: false,
    logger: sessionLogger,
    customer: null,
    policies: [],
    activeClaim: null,
    conversationHistory: [],
    startedAt: new Date().toISOString(),
    maxDurationTimer: undefined,
    callerPhone: null,
    ttsStream: null,
    language: "en",
    pendingFacts: [],
    callSummary: null,
  };

  sessions.set(callId, session);
  startAudioQueueProcessor(session);
  startMaxDurationTimer(session);

  // Persist call session to DB
  createCallSession(callId).catch((err) => {
    sessionLogger.error({ err }, "[BELLA:SESSION] Failed to persist call session to DB");
  });

  sessionLogger.info("[BELLA:SESSION] Session created");
  return session;
}

/** Retrieve a session by callId */
export function getSession(callId: string): Session | undefined {
  return sessions.get(callId);
}

/**
 * Inject customer context into the session after phone number lookup.
 *
 * Called once the Twilio "start" event provides the caller's phone number,
 * allowing us to look up their record and pre-load policies/claims.
 */
export function setCustomerContext(
  session: Session,
  customer: Customer | null,
  policies: Policy[],
): void {
  session.customer = customer;
  session.policies = policies;

  if (customer) {
    session.logger.info(
      { customerId: customer.id, name: `${customer.firstName} ${customer.lastName}` },
      "[BELLA:SESSION] Customer context loaded",
    );
  } else {
    session.logger.info("[BELLA:SESSION] No customer found — unknown caller");
  }
}

/** Get the fully resolved system prompt with customer context */
export function getSessionSystemPrompt(session: Session): string {
  return getSystemPrompt(session);
}

/** Get the tool definitions for the LLM */
export function getSessionToolDefinitions(): typeof TOOL_DEFINITIONS {
  return TOOL_DEFINITIONS;
}

/**
 * Handle tool calls from the LLM and return results.
 *
 * After processing, checks whether `end_call` was invoked. If so,
 * sets `shouldCloseAfterMark` so the session closes gracefully
 * once the final TTS audio finishes playing on the Twilio stream.
 */
export async function handleSessionToolCalls(
  session: Session,
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
): Promise<Array<{ name: string; response: Record<string, unknown> }>> {
  const results = await processToolCalls(toolCalls, session);

  if (session.endCallRequested) {
    session.logger.info(
      "[BELLA:SESSION] end_call requested — will close after final audio plays",
    );
    // Don't set shouldCloseAfterMark yet. We set it after the goodbye
    // TTS audio chunks are queued, so the mark event fires AFTER playback.
  }

  return results;
}

/**
 * Queue audio for Twilio playback and handle end-of-call sequencing.
 *
 * When `endCallRequested` is true, this marks the session to close
 * after the current batch of audio finishes playing. The Twilio "mark"
 * event will trigger the actual teardown.
 */
export function queueAudioForTwilio(
  session: Session,
  audioBase64: string,
): void {
  session.sendQueue.push({ audioInBase64: audioBase64 });

  if (session.endCallRequested && !session.shouldCloseAfterMark) {
    session.shouldCloseAfterMark = true;
    session.lastSeqNumber = session.sequenceNumber;
    session.logger.info(
      { lastSeqNumber: session.lastSeqNumber },
      "[BELLA:SESSION] Marked session for close after final audio",
    );
  }
}

/**
 * Handle a Twilio "mark" event indicating an audio chunk finished playing.
 *
 * If the session is flagged for close and this mark corresponds to
 * the final audio chunk, gracefully end the session.
 */
export function handleTwilioMark(session: Session, markName: string): void {
  const markSeq = parseInt(markName, 10);

  if (
    session.shouldCloseAfterMark &&
    !isNaN(markSeq) &&
    markSeq >= session.lastSeqNumber
  ) {
    session.logger.info(
      { markSeq, lastSeqNumber: session.lastSeqNumber },
      "[BELLA:SESSION] Final audio played — closing session",
    );
    closeSession(session);
  }
}

/**
 * Process the Twilio audio send queue.
 *
 * Runs on a 200ms interval, draining queued audio chunks and sending
 * them to Twilio as media + mark events. The mark events let us track
 * when each chunk finishes playing on the caller's end.
 */
function startAudioQueueProcessor(session: Session): void {
  const processQueue = () => {
    if (session.alreadyClosing) return;

    while (session.sendQueue.length > 0) {
      const item = session.sendQueue.shift()!;

      if ("clearQueueInTwilio" in item) {
        sendToTwilio(session, {
          event: "clear",
          streamSid: session.streamSid,
        });
        continue;
      }

      if ("audioInBase64" in item) {
        const seqNum = session.sequenceNumber++;

        sendToTwilio(session, {
          event: "media",
          streamSid: session.streamSid,
          media: { payload: item.audioInBase64 },
        });

        sendToTwilio(session, {
          event: "mark",
          streamSid: session.streamSid,
          mark: { name: String(seqNum) },
        });
      }
    }

    session.sendQueueInterval = setTimeout(
      processQueue,
      AUDIO_QUEUE_INTERVAL_MS,
    );
  };

  session.sendQueueInterval = setTimeout(
    processQueue,
    AUDIO_QUEUE_INTERVAL_MS,
  );
}

/**
 * Start a timer that auto-completes the call after MAX_CALL_DURATION_MS.
 *
 * If the session is still active when the timer fires, it logs the event
 * and gracefully ends the session. The timer is cancelled if the session
 * ends naturally before the limit.
 */
function startMaxDurationTimer(session: Session): void {
  session.maxDurationTimer = setTimeout(() => {
    if (session.alreadyClosing) return;

    session.logger.info(
      `[BELLA:SESSION] Auto-completing call after 9 minutes — callSid=${session.callId}`,
    );

    closeSession(session);
  }, MAX_CALL_DURATION_MS);
}

/** Send a JSON message to the Twilio WebSocket */
function sendToTwilio(session: Session, message: Record<string, unknown>): void {
  try {
    session.twilioWs.send(JSON.stringify(message));
  } catch (err) {
    session.logger.error({ err }, "[BELLA:SESSION] Failed to send to Twilio");
  }
}

/**
 * Gracefully close a session and clean up all resources.
 *
 * - Clears the audio queue processor interval
 * - Closes the Twilio WebSocket
 * - Removes the session from the in-memory store
 *
 * Safe to call multiple times (idempotent via `alreadyClosing` flag).
 */
export function closeSession(session: Session): void {
  if (session.alreadyClosing) return;
  session.alreadyClosing = true;

  session.logger.info("[BELLA:SESSION] Closing session");

  if (session.maxDurationTimer) {
    clearTimeout(session.maxDurationTimer);
    session.maxDurationTimer = undefined;
  }

  if (session.sendQueueInterval) {
    clearTimeout(session.sendQueueInterval);
    session.sendQueueInterval = undefined;
  }

  if (session.ttsStream) {
    session.ttsStream.close();
    session.ttsStream = null;
  }

  try {
    session.twilioWs.close();
  } catch {
    // WebSocket may already be closed
  }

  sessions.delete(session.callId);

  completeCallSession(session.callId, session.callSummary ?? undefined).catch((err) => {
    session.logger.error({ err }, "[BELLA:SESSION] Failed to update call session status in DB");
  });

  session.logger.info("[BELLA:SESSION] Session closed and cleaned up");
}

/**
 * Handle incoming Twilio WebSocket messages.
 *
 * Dispatches on the Twilio event type:
 * - `start`: Initialize stream, look up customer, connect LLM
 * - `media`: Forward audio to STT pipeline
 * - `mark`: Track audio playback completion, trigger end-of-call
 * - `stop`/`close`: Clean up session
 */
export async function handleTwilioMessage(
  callId: string,
  data: string,
): Promise<void> {
  const session = getSession(callId);
  if (!session) {
    logger.warn({ callId }, "[BELLA:SESSION] Message for unknown session");
    return;
  }

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    session.logger.warn("[BELLA:SESSION] Invalid JSON from Twilio");
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

      session.logger.info(
        { streamSid: start.streamSid },
        "[BELLA:SESSION] Twilio stream started",
      );

      // TODO: Look up customer by phone number from Twilio call metadata
      // const customer = await lookupCustomerByPhone(callerNumber);
      // const policies = await getCustomerPolicies(customer?.id);
      // setCustomerContext(session, customer, policies);

      // TODO: Connect to Gemini with system prompt + tools
      // const systemPrompt = getSessionSystemPrompt(session);
      // const tools = getSessionToolDefinitions();
      // await connectToGemini(session, systemPrompt, tools);
      break;
    }

    case "media": {
      const media = msg.media as { payload: string; timestamp: string };

      // TODO: Forward audio to Gradium STT
      // sttClient.sendAudio(media.payload, media.timestamp);
      void media;
      break;
    }

    case "mark": {
      const mark = msg.mark as { name: string };
      handleTwilioMark(session, mark.name);
      break;
    }

    case "stop":
    case "close": {
      session.logger.info(
        { event },
        "[BELLA:SESSION] Twilio stream ended",
      );
      closeSession(session);
      break;
    }

    default:
      session.logger.debug({ event }, "[BELLA:SESSION] Unhandled Twilio event");
  }
}
