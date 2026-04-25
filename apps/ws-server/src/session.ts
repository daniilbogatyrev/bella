import { eq } from 'drizzle-orm';
import { getDb, callSessions, transcripts, customers, policies, claims } from '@bella/db';
import type {
  Session,
  PlaybackState,
  TwilioStartEvent,
  TwilioMediaEvent,
  TwilioMarkEvent,
} from './types';
import { mixChunkWithBackground, getBackgroundOnlyChunk } from './bg-noise';
import {
  parseTwilioMessage,
  createMediaMessage,
  createMarkMessage,
  createClearMessage,
} from './twilio';
import { createLLMClient, type LLMClient } from './llm';
import { speechToText, isStreamingSTTEnabled, createStreamingSTT } from './stt';
import { type ToolContext } from './tools';
import pino from 'pino';

const logger = pino({ name: 'bella-session' });

const AUDIO_QUEUE_INTERVAL_MS = 20;
const AUDIO_BUFFER_THRESHOLD_BYTES = 16_000; // ~2 seconds of mulaw 8kHz audio

/** 160 bytes = 20ms of mulaw 8kHz mono audio — Twilio's expected chunk size. */
const TWILIO_CHUNK_BYTES = 160;

/** Minimum sent chunks before we consider user audio a real barge-in (noise filter).
 *  25 chunks × 20ms = 500ms of audio must play before allowing interruption.
 *  Twilio sends ambient media events constantly from the phone mic — low values
 *  cause the greeting to be killed immediately by background noise. */
const BARGEIN_MIN_SENT_CHUNKS = 25;

/** Default playback state — no audio in flight. */
function defaultPlaybackState(): PlaybackState {
  return { fullText: '', totalChunks: 0, sentChunks: 0, isPlaying: false };
}

/** Known STT artifacts that represent noise, not actual speech. */
const NON_SPEECH_PHRASES = [
  '(static sound)', '(static)', '(noise)', '(silence)',
  '(background noise)', '(water flowing)', '(clears throat)',
  '(music)', '(applause)', '(laughter)', '(coughing)',
  '(breathing)', '(clicking)', '(buzzing)',
];

/**
 * Detect STT transcripts that represent noise artifacts rather than actual speech.
 * Catches parenthetical descriptions like "(static sound)" and very short non-word text.
 */
export function isNonSpeech(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower || lower.length < 2) return true;
  if (/^\(.*\)$/.test(lower)) return true;
  return NON_SPEECH_PHRASES.includes(lower);
}

/**
 * Truncate text to the nearest word boundary at or before maxLength.
 * Returns the original text when maxLength exceeds its length.
 */
export function truncateToWordBoundary(text: string, maxLength: number): string {
  if (maxLength >= text.length) return text;
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
}

/**
 * Replace the last assistant ("model") message in conversation history
 * with only the portion the caller actually heard before interrupting.
 */
export function truncateLastAssistantMessage(
  session: Session,
  heardText: string,
): void {
  for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
    if (session.conversationHistory[i]!.role === 'model') {
      const original = session.conversationHistory[i]!.content;
      session.conversationHistory[i]!.content = heardText;
      console.log(
        `[BELLA:BARGEIN] Truncated last assistant message — original=${original.length}chars heard=${heardText.length}chars`,
      );
      return;
    }
  }
}

interface CustomerWithRelations {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  address: string | null;
  policies: Array<{
    id: string;
    type: string;
    planName: string;
    status: string;
    startDate: string;
    endDate: string | null;
    coveredItems: string | null;
    notCoveredItems: string | null;
  }>;
  claims: Array<{
    id: string;
    type: string;
    status: string;
    description: string | null;
    createdAt: Date;
  }>;
}

/**
 * Build a structured customer context block for the LLM system prompt.
 * Includes customer profile, active policies with coverage, and open claims.
 */
function buildCustomerContext(customer: CustomerWithRelations): string {
  const lines: string[] = [];

  lines.push('## Current Caller Information');
  lines.push(`Name: ${customer.firstName} ${customer.lastName}`);
  lines.push(`Phone: ${customer.phone}`);
  if (customer.email) lines.push(`Email: ${customer.email}`);
  if (customer.address) lines.push(`Address: ${customer.address}`);
  lines.push(`Customer ID: ${customer.id}`);

  if (customer.policies.length > 0) {
    lines.push('');
    lines.push('## Their Active Policies');
    for (const p of customer.policies) {
      let policyLine = `- ${p.planName} (${p.type}, Policy #${p.id.substring(0, 8)}, status: ${p.status})`;
      if (p.coveredItems) policyLine += `. Covers: ${p.coveredItems}`;
      if (p.notCoveredItems) policyLine += `. Does NOT cover: ${p.notCoveredItems}`;
      lines.push(policyLine);
    }
  } else {
    lines.push('');
    lines.push('## Their Active Policies');
    lines.push('No policies on file.');
  }

  const openClaims = customer.claims.filter((c) =>
    c.status !== 'closed' && c.status !== 'denied' && c.status !== 'resolved',
  );
  if (openClaims.length > 0) {
    lines.push('');
    lines.push('## Open Claims');
    for (const c of openClaims) {
      const opened = c.createdAt.toISOString().split('T')[0];
      const desc = c.description ? ` — ${c.description}` : '';
      lines.push(`- Claim #${c.id.substring(0, 8)} (${c.type}, status: ${c.status}) — opened ${opened}${desc}`);
    }
  }

  return lines.join('\n');
}

/**
 * Manages active call sessions. Each session maps a Twilio callSid to its
 * WebSocket connection, conversation state, and audio queue.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private llmClients = new Map<string, LLMClient>();

  /**
   * Create a new session for an incoming call.
   *
   * @param callSid - Twilio call SID (unique per call)
   * @param ws - WebSocket-like object with a send method
   * @returns The newly created session
   */
  createSession(callSid: string, ws: { send: (data: string) => void }): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      callSid,
      streamSid: '',
      callerPhone: '',
      ws,
      conversationHistory: [],
      audioQueue: [],
      audioBuffer: [],
      audioBufferBytes: 0,
      markSequence: 0,
      status: 'initializing',
      processing: false,
      startedAt: new Date(),
      playback: defaultPlaybackState(),
      bgSeekPosition: 0,
    };

    this.sessions.set(callSid, session);
    console.log(`[BELLA:SESSION] New session created — sessionId=${session.id} callSid=${callSid}`);
    logger.info({ sessionId: session.id, callSid }, 'Session created');
    return session;
  }

  /**
   * Route an incoming Twilio WebSocket message to the appropriate handler.
   *
   * @param callSid - The call SID this message belongs to
   * @param rawMessage - Raw message data from the WebSocket
   */
  handleTwilioMessage(callSid: string, rawMessage: string | Buffer): void {
    const session = this.sessions.get(callSid);
    if (!session) {
      logger.warn({ callSid }, 'No session found for callSid');
      return;
    }

    const message = parseTwilioMessage(rawMessage);
    if (!message) {
      logger.warn({ callSid }, 'Failed to parse Twilio message');
      return;
    }

    switch (message.event) {
      case 'connected':
        console.log(`[BELLA:TWILIO] Connected event received — callSid=${callSid}`);
        logger.info({ callSid }, 'Twilio connected');
        break;
      case 'start':
        console.log(`[BELLA:TWILIO] Start event — callSid=${callSid} streamSid=${(message as TwilioStartEvent).start?.streamSid}`);
        this.handleStart(session, message);
        break;
      case 'media':
        this.handleMedia(session, message);
        break;
      case 'mark':
        this.handleMark(session, message);
        break;
      case 'stop':
        console.log(`[BELLA:TWILIO] Stop event — callSid=${callSid}`);
        this.handleStop(session);
        break;
    }
  }

  handleStart(session: Session, message: TwilioStartEvent): void {
    session.streamSid = message.start.streamSid;
    session.callerPhone = message.start.customParameters?.callerPhone || '';
    session.status = 'active';

    this.startContinuousBackground(session);

    // Set up streaming STT if the provider supports it (ElevenLabs WebSocket)
    if (isStreamingSTTEnabled()) {
      session.sttStream = createStreamingSTT(
        (text: string) => {
          this.handleStreamingTranscript(session, text);
        },
        () => {
          // VAD detected speech — trigger barge-in if playing audio
          if (session.playback.isPlaying) {
            this.handleInterruption(session);
          }
        },
        session.callSid,
      );
      console.log(`[BELLA:SESSION] Streaming STT attached — callSid=${session.callSid}`);
    }

    console.log(`[BELLA:SESSION] Session now active — callSid=${session.callSid} streamSid=${session.streamSid} callerPhone=${session.callerPhone} status=active streaming=${!!session.sttStream}`);
    logger.info(
      { streamSid: session.streamSid, callerPhone: session.callerPhone },
      'Stream started',
    );

    this.initializePipeline(session).catch((err) => {
      console.error(`[BELLA:SESSION] Pipeline initialization failed — callSid=${session.callSid}`, err);
      logger.error({ err, callSid: session.callSid }, 'Pipeline initialization failed');
    });
  }

  handleMedia(session: Session, message: TwilioMediaEvent): void {
    if (session.status !== 'active') return;

    const payload = message.media.payload;

    // --- Streaming mode (ElevenLabs WebSocket) ---
    // Pipe every audio chunk directly to the STT stream. VAD in the ElevenLabs
    // service detects speech boundaries and fires committed_transcript events.
    // The onSpeechStart callback (partial transcripts) handles barge-in.
    if (session.sttStream) {
      session.sttStream.sendAudio(payload);
      return;
    }

    // --- Buffered mode (Gradium / ElevenLabs REST fallback) ---
    if (session.playback.isPlaying) {
      this.handleInterruption(session);
    }

    const chunkBytes = Math.ceil((payload.length * 3) / 4);

    session.audioBuffer.push(payload);
    session.audioBufferBytes += chunkBytes;

    if (session.audioBufferBytes >= AUDIO_BUFFER_THRESHOLD_BYTES && !session.processing) {
      console.log(`[BELLA:TWILIO] Audio buffer threshold reached — callSid=${session.callSid} bufferBytes=${session.audioBufferBytes} chunks=${session.audioBuffer.length}`);
      this.flushAudioBuffer(session);
    }
  }

  handleMark(session: Session, message: TwilioMarkEvent): void {
    session.lastMarkName = message.mark.name;
    // Mark event means Twilio finished playing all audio up to this mark
    if (session.playback.isPlaying && session.audioQueue.length === 0) {
      session.playback.isPlaying = false;
      console.log(
        `[BELLA:SESSION] Playback complete — callSid=${session.callSid} mark=${message.mark.name}`,
      );
    }
  }

  handleStop(session: Session): void {
    console.log(`[BELLA:TWILIO] Stream stop event — callSid=${session.callSid}`);
    logger.info({ callSid: session.callSid }, 'Stream stopped');
    this.endSession(session.callSid);
  }

  /**
   * Handle a barge-in interruption: the caller started speaking while Bella
   * was still playing TTS audio.
   *
   * 1. Clears the unsent audio queue
   * 2. Sends a "clear" message to Twilio to stop current playback
   * 3. Estimates the text the caller actually heard
   * 4. Truncates the last assistant message in conversation history
   */
  handleInterruption(session: Session): void {
    const { playback } = session;

    if (playback.sentChunks < BARGEIN_MIN_SENT_CHUNKS) {
      return;
    }

    console.log(
      `[BELLA:BARGEIN] Detected interruption — sentChunks=${playback.sentChunks} ` +
        `totalChunks=${playback.totalChunks} queueLen=${session.audioQueue.length} ` +
        `callSid=${session.callSid}`,
    );

    // Stop playback FIRST — the continuous loop will fall back to bg-only
    playback.isPlaying = false;

    const clearedChunks = session.audioQueue.length;
    session.audioQueue = [];

    if (session.streamSid) {
      const clearMsg = createClearMessage(session.streamSid);
      console.log(
        `[BELLA:BARGEIN] Sending clear to Twilio — streamSid=${session.streamSid} queueCleared=${clearedChunks} clearMsg=${clearMsg}`,
      );
      session.ws.send(clearMsg);
    } else {
      console.warn(
        `[BELLA:BARGEIN] Cannot send clear — no streamSid on session! callSid=${session.callSid}`,
      );
    }

    const heardRatio =
      playback.totalChunks > 0
        ? playback.sentChunks / playback.totalChunks
        : 0;
    const heardLength = Math.floor(playback.fullText.length * heardRatio);
    const heardText = truncateToWordBoundary(playback.fullText, heardLength);

    console.log(
      `[BELLA:BARGEIN] Interruption handled — callSid=${session.callSid} ` +
        `sent=${playback.sentChunks}/${playback.totalChunks} cleared=${clearedChunks} ` +
        `heardRatio=${(heardRatio * 100).toFixed(1)}% ` +
        `heard="${heardText.substring(0, 80)}${heardText.length > 80 ? '...' : ''}" ` +
        `full="${playback.fullText.substring(0, 80)}${playback.fullText.length > 80 ? '...' : ''}"`,
    );

    if (heardText.length > 0) {
      truncateLastAssistantMessage(session, heardText);
    } else {
      for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
        if (session.conversationHistory[i]!.role === 'model') {
          session.conversationHistory.splice(i, 1);
          console.log(`[BELLA:BARGEIN] Removed unheard assistant message from history`);
          break;
        }
      }
    }

    playback.sentChunks = 0;
    playback.totalChunks = 0;
    playback.fullText = '';
  }

  /**
   * Chunk base64-encoded mulaw audio into Twilio-sized ~20ms segments and queue them.
   *
   * Twilio Media Streams expects small audio chunks (~160 bytes of mulaw = 20ms at 8kHz).
   * Sending the entire TTS output as one payload causes silent playback.
   * Only the last chunk carries a mark so we know when playback finishes.
   *
   * @param session - The active session
   * @param base64Audio - Base64-encoded mulaw 8kHz audio data from Gradium TTS
   * @param responseText - The LLM response text that this audio represents (for barge-in tracking)
   */
  sendAudioToTwilio(session: Session, base64Audio: string, responseText?: string): void {
    if (session.status !== 'active' || !session.streamSid) {
      console.log(`[BELLA:TWILIO] Cannot send audio — status=${session.status} streamSid=${session.streamSid || 'none'} callSid=${session.callSid}`);
      return;
    }

    const rawBuf = Buffer.from(base64Audio, 'base64');
    const totalBytes = rawBuf.length;

    if (totalBytes === 0) {
      console.warn(`[BELLA:TWILIO] TTS returned empty audio — callSid=${session.callSid}`);
      return;
    }

    session.markSequence++;
    const markName = `mark_${session.markSequence}`;

    let chunkCount = 0;
    for (let offset = 0; offset < totalBytes; offset += TWILIO_CHUNK_BYTES) {
      const end = Math.min(offset + TWILIO_CHUNK_BYTES, totalBytes);
      const chunkB64 = rawBuf.subarray(offset, end).toString('base64');
      const isLast = end >= totalBytes;

      session.audioQueue.push({
        payload: chunkB64,
        markName: isLast ? markName : undefined,
      });
      chunkCount++;
    }

    // Initialize playback tracking for barge-in detection
    session.playback = {
      fullText: responseText || '',
      totalChunks: chunkCount,
      sentChunks: 0,
      isPlaying: true,
    };

    const durationMs = Math.round((totalBytes / 8000) * 1000);
    console.log(`[BELLA:TWILIO] Chunked audio for Twilio — callSid=${session.callSid} totalBytes=${totalBytes} chunks=${chunkCount} chunkSize=${TWILIO_CHUNK_BYTES} durationMs=~${durationMs} mark=${markName} queueLen=${session.audioQueue.length}`);
  }

  /**
   * Start the continuous background audio loop.
   *
   * Runs every 20ms (one Twilio chunk). When TTS audio is queued, sends TTS
   * mixed with background noise. Otherwise sends background noise only, so
   * the caller always hears ambient call-center audio.
   */
  private startContinuousBackground(session: Session): void {
    const bgEnabled = process.env.BG_NOISE_ENABLED !== 'false';
    const bgGain = parseFloat(process.env.BG_NOISE_GAIN || '0.04') || 0.04;

    session.bgInterval = setInterval(() => {
      try {
        if (!session.ws || !session.streamSid || session.status !== 'active') {
          return;
        }

        if (session.audioQueue.length > 0 && session.playback.isPlaying) {
        const item = session.audioQueue.shift()!;

        let payload: string;
        if (bgEnabled) {
          const rawChunk = Buffer.from(item.payload, 'base64');
          const { mixed, newSeekPosition } = mixChunkWithBackground(rawChunk, session.bgSeekPosition, bgGain);
          session.bgSeekPosition = newSeekPosition;
          payload = mixed.toString('base64');
        } else {
          payload = item.payload;
        }

        const mediaMsg = createMediaMessage(session.streamSid, payload);
        session.ws.send(mediaMsg);
        session.playback.sentChunks++;

        if (item.markName) {
          const markMsg = createMarkMessage(session.streamSid, item.markName);
          session.ws.send(markMsg);
        }

        if (session.audioQueue.length === 0) {
          session.playback.isPlaying = false;
          session.playback.currentMark = item.markName;
        }
      } else if (bgEnabled) {
        const { chunk, newSeekPosition } = getBackgroundOnlyChunk(TWILIO_CHUNK_BYTES, session.bgSeekPosition, bgGain);
        session.bgSeekPosition = newSeekPosition;

        const mediaMsg = createMediaMessage(session.streamSid, chunk);
        session.ws.send(mediaMsg);
      }
      } catch (err) {
        console.error(`[BELLA:BGNOISE] Continuous loop error — callSid=${session.callSid}`, err);
      }
    }, AUDIO_QUEUE_INTERVAL_MS);

    console.log(`[BELLA:BGNOISE] Continuous background started — callSid=${session.callSid}`);
  }

  /** Stop the continuous background audio loop. */
  private stopContinuousBackground(session: Session): void {
    if (session.bgInterval) {
      clearInterval(session.bgInterval);
      session.bgInterval = undefined;
      console.log(`[BELLA:BGNOISE] Continuous background stopped — callSid=${session.callSid}`);
    }
  }

  /**
   * End a session: stop its continuous background loop, mark as closed, remove from map.
   */
  endSession(callSid: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;

    const durationMs = Date.now() - session.startedAt.getTime();
    console.log(`[BELLA:SESSION] Ending session — callSid=${callSid} sessionId=${session.id} status=${session.status} duration=${durationMs}ms turns=${session.conversationHistory.length}`);
    session.status = 'closed';

    this.stopContinuousBackground(session);

    // Close the streaming STT WebSocket if active
    if (session.sttStream) {
      session.sttStream.close();
      session.sttStream = undefined;
    }

    session.audioQueue.length = 0;
    this.llmClients.get(callSid)?.endChat();
    this.llmClients.delete(callSid);
    this.sessions.delete(callSid);

    this.finalizeSession(session).catch((err) => {
      logger.error({ err, callSid }, 'Session finalization failed');
    });

    logger.info({ sessionId: session.id, callSid }, 'Session ended');
  }

  /** Returns a snapshot array of all currently active sessions. */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** Look up a session by its Twilio call SID. */
  getSession(callSid: string): Session | undefined {
    return this.sessions.get(callSid);
  }

  private async initializePipeline(session: Session): Promise<void> {
    session.processing = true;
    const pipelineStart = Date.now();

    try {
      console.log(`[BELLA:SESSION] Initializing pipeline — callSid=${session.callSid} callerPhone=${session.callerPhone}`);
      const db = getDb();

      const [dbSession] = await db
        .insert(callSessions)
        .values({
          twilioCallSid: session.callSid,
          callerPhone: session.callerPhone || 'unknown',
          status: 'active',
        })
        .returning();

      session.dbSessionId = dbSession!.id;
      console.log(`[BELLA:SESSION] DB session created — dbSessionId=${session.dbSessionId}`);

      const ctx: ToolContext = {
        sessionId: session.dbSessionId,
        callerPhone: session.callerPhone,
      };

      let customerContext = '';

      if (session.callerPhone) {
        console.log(`[BELLA:SESSION] Looking up customer — phone=${session.callerPhone}`);
        const customer = await db.query.customers.findFirst({
          where: eq(customers.phone, session.callerPhone),
          with: { policies: true, claims: true },
        });

        if (customer) {
          session.customerId = customer.id;
          ctx.customerId = customer.id;
          console.log(`[BELLA:SESSION] Customer found — id=${customer.id} name=${customer.firstName} ${customer.lastName} policies=${customer.policies.length} claims=${customer.claims.length}`);

          await db
            .update(callSessions)
            .set({ customerId: customer.id })
            .where(eq(callSessions.id, session.dbSessionId));

          customerContext = buildCustomerContext(customer);
        } else {
          console.log(`[BELLA:SESSION] No customer found for phone=${session.callerPhone}`);
          customerContext = `## Current Caller Information\nPhone: ${session.callerPhone}\nStatus: New caller — not found in our system. Ask for their name and details.`;
        }
      } else {
        customerContext = '## Current Caller Information\nPhone: Unknown\nStatus: New caller — not found in our system. Ask for their name and details.';
      }

      const llm = createLLMClient();
      llm.startChat(customerContext);
      this.llmClients.set(session.callSid, llm);
      console.log(`[BELLA:SESSION] LLM chat session started — callSid=${session.callSid} customerContextLen=${customerContext.length}`);

      const greeting = session.customerId
        ? `A returning customer is calling from ${session.callerPhone}. Greet them by name if possible and ask how you can help.`
        : `A new caller is calling from ${session.callerPhone || 'an unknown number'}. Greet them warmly and ask how you can help.`;

      console.log(`[BELLA:SESSION] Sending auto-greeting — isReturning=${!!session.customerId}`);
      const response = await llm.chat(greeting, ctx);
      const text = response.text || 'Hi there! This is Bella from SafeGuard Insurance. How can I help you today?';
      console.log(`[BELLA:SESSION] Auto-greeting: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

      session.conversationHistory.push({ role: 'model', content: text });
      await this.saveTranscript(session, 'agent', text);

      const { getGradiumClient } = await import('./gradium');
      const gradium = getGradiumClient();
      console.log(`[BELLA:SESSION] Converting greeting to audio via TTS`);
      const audioBase64 = await gradium.textToSpeech(text);
      console.log(`[BELLA:SESSION] TTS complete — audioSize=${Math.ceil((audioBase64.length * 3) / 4)}bytes`);
      this.sendAudioToTwilio(session, audioBase64, text);

      console.log(
        `[BELLA:SESSION] Pipeline initialized with auto-greeting — callSid=${session.callSid} ` +
          `elapsed=${Date.now() - pipelineStart}ms`,
      );
      logger.info({ callSid: session.callSid }, 'Pipeline initialized with greeting');
    } catch (err) {
      console.error(`[BELLA:SESSION] Pipeline init error — callSid=${session.callSid} elapsed=${Date.now() - pipelineStart}ms`, err);
      logger.error({ err, callSid: session.callSid }, 'Pipeline init error');
    } finally {
      session.processing = false;
    }
  }

  /**
   * Handle a committed transcript from the ElevenLabs WebSocket STT stream.
   *
   * This is called when ElevenLabs' VAD detects a complete utterance.
   * Unlike the buffered path, we already have the text — no STT call needed.
   */
  private handleStreamingTranscript(session: Session, text: string): void {
    if (session.status !== 'active') return;

    if (isNonSpeech(text)) {
      console.log(`[BELLA:SESSION] Ignoring non-speech streaming transcript: "${text}" — callSid=${session.callSid}`);
      return;
    }

    console.log(`[BELLA:SESSION] Streaming transcript received — callSid=${session.callSid} text="${text}"`);

    this.processTranscribedTurn(session, text).catch((err) => {
      logger.error({ err, callSid: session.callSid }, 'Streaming conversation turn failed');
    });
  }

  private flushAudioBuffer(session: Session): void {
    if (session.audioBuffer.length === 0) return;

    const chunks = session.audioBuffer;
    session.audioBuffer = [];
    session.audioBufferBytes = 0;

    const combinedAudio =
      chunks.length === 1
        ? chunks[0]!
        : Buffer.concat(chunks.map(c => Buffer.from(c, 'base64'))).toString('base64');

    this.processConversationTurn(session, combinedAudio).catch((err) => {
      logger.error({ err, callSid: session.callSid }, 'Conversation turn failed');
    });
  }

  private async processConversationTurn(session: Session, audioBase64: string): Promise<void> {
    if (session.processing || session.status !== 'active') return;
    session.processing = true;
    const turnStart = Date.now();

    try {
      const audioSizeBytes = Math.ceil((audioBase64.length * 3) / 4);
      console.log(`[BELLA:SESSION] === Conversation turn start (buffered) === callSid=${session.callSid} audioSize=${audioSizeBytes}bytes`);

      const sttStart = Date.now();
      const userText = await speechToText(audioBase64);
      console.log(`[BELLA:STT] Transcription complete — text="${userText}" sttTime=${Date.now() - sttStart}ms`);

      if (!userText.trim()) {
        console.log(`[BELLA:SESSION] Empty transcription, skipping turn — callSid=${session.callSid}`);
        return;
      }

      if (isNonSpeech(userText)) {
        console.log(`[BELLA:SESSION] Ignoring non-speech transcript: "${userText}" — callSid=${session.callSid}`);
        return;
      }

      await this.runLLMAndTTS(session, userText, turnStart);
    } catch (err) {
      console.error(`[BELLA:SESSION] Conversation turn error — callSid=${session.callSid} elapsed=${Date.now() - turnStart}ms`, err);
      logger.error({ err, callSid: session.callSid }, 'Conversation turn error');
    } finally {
      session.processing = false;
    }
  }

  /**
   * Process a turn that already has the transcribed text (used by streaming STT path).
   */
  private async processTranscribedTurn(session: Session, userText: string): Promise<void> {
    if (session.processing || session.status !== 'active') return;
    session.processing = true;
    const turnStart = Date.now();

    try {
      console.log(`[BELLA:SESSION] === Conversation turn start (streaming) === callSid=${session.callSid}`);
      await this.runLLMAndTTS(session, userText, turnStart);
    } catch (err) {
      console.error(`[BELLA:SESSION] Streaming turn error — callSid=${session.callSid} elapsed=${Date.now() - turnStart}ms`, err);
      logger.error({ err, callSid: session.callSid }, 'Streaming conversation turn error');
    } finally {
      session.processing = false;
    }
  }

  /**
   * Core LLM + TTS pipeline shared by both buffered and streaming STT paths.
   */
  private async runLLMAndTTS(session: Session, userText: string, turnStart: number): Promise<void> {
    session.conversationHistory.push({ role: 'user', content: userText });
    await this.saveTranscript(session, 'customer', userText);

    const llm = this.llmClients.get(session.callSid);
    if (!llm) {
      console.log(`[BELLA:SESSION] No LLM client found, skipping — callSid=${session.callSid}`);
      return;
    }

    const ctx: ToolContext = {
      sessionId: session.dbSessionId || session.id,
      callerPhone: session.callerPhone,
      customerId: session.customerId,
      claimId: session.claimId,
    };

    const llmStart = Date.now();
    console.log(`[BELLA:LLM] Sending user message: "${userText}"`);
    const response = await llm.chat(userText, ctx);
    console.log(`[BELLA:LLM] LLM responded in ${Date.now() - llmStart}ms`);

    for (const tc of response.toolCalls) {
      session.conversationHistory.push({
        role: 'function',
        content: JSON.stringify(tc.result),
        toolName: tc.name,
        toolInput: tc.args,
        toolResult: tc.result,
      });
      await this.saveTranscript(session, 'tool', JSON.stringify(tc.result), tc.name, tc.args, tc.result);

      if (tc.name === 'open_claim') {
        const claimResult = tc.result as { claimId?: string };
        if (claimResult.claimId) {
          session.claimId = claimResult.claimId;
        }
      }
    }

    const agentText = response.text || '';
    if (agentText) {
      console.log(`[BELLA:LLM] Response: "${agentText.substring(0, 150)}${agentText.length > 150 ? '...' : ''}"`);
      session.conversationHistory.push({ role: 'model', content: agentText });
      await this.saveTranscript(session, 'agent', agentText);

      const { getGradiumClient } = await import('./gradium');
      const gradium = getGradiumClient();
      const ttsStart = Date.now();
      const ttsAudio = await gradium.textToSpeech(agentText);
      console.log(`[BELLA:TTS] TTS complete — ttsTime=${Date.now() - ttsStart}ms audioSize=${Math.ceil((ttsAudio.length * 3) / 4)}bytes`);
      this.sendAudioToTwilio(session, ttsAudio, agentText);
    }

    console.log(`[BELLA:SESSION] === Conversation turn end === callSid=${session.callSid} totalTime=${Date.now() - turnStart}ms`);
  }

  private async finalizeSession(session: Session): Promise<void> {
    if (!session.dbSessionId) return;

    try {
      console.log(`[BELLA:SESSION] Finalizing session — dbSessionId=${session.dbSessionId} historyLen=${session.conversationHistory.length}`);
      const db = getDb();
      const llm = createLLMClient();

      const historyText = session.conversationHistory
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const summary = historyText
        ? await llm.generateSummary(historyText)
        : 'Call ended with no conversation.';
      console.log(`[BELLA:SESSION] Summary generated: "${summary.substring(0, 150)}${summary.length > 150 ? '...' : ''}"`);

      await db
        .update(callSessions)
        .set({
          status: 'completed',
          endedAt: new Date(),
          summary,
          claimId: session.claimId || undefined,
        })
        .where(eq(callSessions.id, session.dbSessionId));

      console.log(`[BELLA:SESSION] Session finalized in DB — dbSessionId=${session.dbSessionId} claimId=${session.claimId || 'none'}`);
      logger.info({ sessionId: session.dbSessionId }, 'Session finalized');
    } catch (err) {
      console.error(`[BELLA:SESSION] Finalization error — dbSessionId=${session.dbSessionId}`, err);
      logger.error({ err, sessionId: session.dbSessionId }, 'Finalization error');
    }
  }

  private async saveTranscript(
    session: Session,
    role: 'customer' | 'agent' | 'system' | 'tool',
    content: string,
    toolName?: string,
    toolInput?: Record<string, unknown>,
    toolResult?: unknown,
  ): Promise<void> {
    if (!session.dbSessionId) return;

    try {
      const db = getDb();
      await db.insert(transcripts).values({
        sessionId: session.dbSessionId,
        role,
        content,
        toolName: toolName || null,
        toolInput: toolInput || null,
        toolResult: (toolResult as Record<string, unknown>) || null,
      });
    } catch (err) {
      logger.error({ err, sessionId: session.dbSessionId }, 'Failed to save transcript');
    }
  }
}
