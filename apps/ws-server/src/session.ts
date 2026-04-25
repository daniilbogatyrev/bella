import { eq } from 'drizzle-orm';
import { getDb, callSessions, transcripts } from '@bella/db';
import type {
  Session,
  TwilioStartEvent,
  TwilioMediaEvent,
  TwilioMarkEvent,
} from './types';
import {
  parseTwilioMessage,
  createMediaMessage,
  createMarkMessage,
} from './twilio';
import { getGradiumClient } from './gradium';
import { getGeminiClient, type GeminiClient } from './llm';
import { executeTool, type ToolContext } from './tools';
import pino from 'pino';

const logger = pino({ name: 'bella-session' });

const AUDIO_QUEUE_INTERVAL_MS = 200;
const AUDIO_BUFFER_THRESHOLD_BYTES = 16_000; // ~2 seconds of mulaw 8kHz audio

/**
 * Manages active call sessions. Each session maps a Twilio callSid to its
 * WebSocket connection, conversation state, and audio queue.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private geminiClients = new Map<string, GeminiClient>();

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

    session.audioQueueInterval = setInterval(
      () => this.processAudioQueue(session),
      AUDIO_QUEUE_INTERVAL_MS,
    );

    console.log(`[BELLA:SESSION] Session now active — callSid=${session.callSid} streamSid=${session.streamSid} callerPhone=${session.callerPhone} status=active`);
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
  }

  handleStop(session: Session): void {
    console.log(`[BELLA:TWILIO] Stream stop event — callSid=${session.callSid}`);
    logger.info({ callSid: session.callSid }, 'Stream stopped');
    this.endSession(session.callSid);
  }

  /**
   * Queue base64-encoded audio to be sent to Twilio, with a mark for playback tracking.
   *
   * @param session - The active session
   * @param base64Audio - Base64-encoded mulaw audio data
   */
  sendAudioToTwilio(session: Session, base64Audio: string): void {
    if (session.status !== 'active' || !session.streamSid) return;

    session.markSequence++;
    const markName = `mark_${session.markSequence}`;
    const audioSizeBytes = Math.ceil((base64Audio.length * 3) / 4);
    console.log(`[BELLA:TWILIO] Queueing audio to Twilio — callSid=${session.callSid} audioSize=${audioSizeBytes}bytes mark=${markName} queueLen=${session.audioQueue.length + 1}`);
    session.audioQueue.push({ payload: base64Audio, markName });
  }

  processAudioQueue(session: Session): void {
    if (session.audioQueue.length === 0) return;
    if (!session.streamSid || session.status !== 'active') return;

    const item = session.audioQueue.shift();
    if (!item) return;

    const mediaMsg = createMediaMessage(session.streamSid, item.payload);
    session.ws.send(mediaMsg);

    if (item.markName) {
      const markMsg = createMarkMessage(session.streamSid, item.markName);
      session.ws.send(markMsg);
    }
  }

  /**
   * End a session: stop its audio queue interval, mark as closed, remove from map.
   */
  endSession(callSid: string): void {
    const session = this.sessions.get(callSid);
    if (!session) return;

    const durationMs = Date.now() - session.startedAt.getTime();
    console.log(`[BELLA:SESSION] Ending session — callSid=${callSid} sessionId=${session.id} status=${session.status} duration=${durationMs}ms turns=${session.conversationHistory.length}`);
    session.status = 'closed';

    if (session.audioQueueInterval) {
      clearInterval(session.audioQueueInterval);
      session.audioQueueInterval = undefined;
    }

    session.audioQueue.length = 0;
    this.geminiClients.get(callSid)?.endChat();
    this.geminiClients.delete(callSid);
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

      const gemini = getGeminiClient();
      gemini.startChat();
      this.geminiClients.set(session.callSid, gemini);
      console.log(`[BELLA:SESSION] Gemini chat session started — callSid=${session.callSid}`);

      const ctx: ToolContext = {
        sessionId: session.dbSessionId,
        callerPhone: session.callerPhone,
      };

      if (session.callerPhone) {
        console.log(`[BELLA:SESSION] Looking up customer — phone=${session.callerPhone}`);
        const lookupResult = await executeTool('lookup_customer', { phone: session.callerPhone }, ctx);
        const lookup = lookupResult as { found: boolean; customer?: { id: string; firstName: string } };
        console.log(`[BELLA:SESSION] Customer lookup result — found=${lookup.found} customerId=${lookup.customer?.id || 'N/A'} name=${lookup.customer?.firstName || 'N/A'}`);

        if (lookup.found && lookup.customer) {
          session.customerId = lookup.customer.id;
          ctx.customerId = lookup.customer.id;

          await db
            .update(callSessions)
            .set({ customerId: lookup.customer.id })
            .where(eq(callSessions.id, session.dbSessionId));
        }
      }

      const greeting = session.customerId
        ? `A returning customer is calling from ${session.callerPhone}. Greet them by name if possible and ask how you can help.`
        : `A new caller is calling from ${session.callerPhone || 'an unknown number'}. Greet them warmly and ask how you can help.`;

      console.log(`[BELLA:SESSION] Requesting initial greeting from Gemini — isReturning=${!!session.customerId}`);
      const response = await gemini.chat(greeting);
      const text = response.text?.() || 'Hi there! This is Bella from SafeGuard Insurance. How can I help you today?';
      console.log(`[BELLA:SESSION] Greeting response: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

      session.conversationHistory.push({ role: 'model', content: text });
      await this.saveTranscript(session, 'agent', text);

      const gradium = getGradiumClient();
      console.log(`[BELLA:SESSION] Converting greeting to audio via TTS`);
      const audioBase64 = await gradium.textToSpeech(text);
      console.log(`[BELLA:SESSION] TTS complete — audioSize=${Math.ceil((audioBase64.length * 3) / 4)}bytes`);
      this.sendAudioToTwilio(session, audioBase64);

      console.log(`[BELLA:SESSION] Pipeline initialized successfully — callSid=${session.callSid}`);
      logger.info({ callSid: session.callSid }, 'Pipeline initialized with greeting');
    } catch (err) {
      console.error(`[BELLA:SESSION] Pipeline init error — callSid=${session.callSid}`, err);
      logger.error({ err, callSid: session.callSid }, 'Pipeline init error');
    }
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
      console.log(`[BELLA:SESSION] === Conversation turn start === callSid=${session.callSid} audioSize=${audioSizeBytes}bytes`);

      const gradium = getGradiumClient();
      const sttStart = Date.now();
      const userText = await gradium.speechToText(audioBase64);
      console.log(`[BELLA:STT] Transcription complete — text="${userText}" sttTime=${Date.now() - sttStart}ms`);

      if (!userText.trim()) {
        console.log(`[BELLA:SESSION] Empty transcription, skipping turn — callSid=${session.callSid}`);
        session.processing = false;
        return;
      }

      session.conversationHistory.push({ role: 'user', content: userText });
      await this.saveTranscript(session, 'customer', userText);

      const gemini = this.geminiClients.get(session.callSid);
      if (!gemini) {
        console.log(`[BELLA:SESSION] No Gemini client found, skipping — callSid=${session.callSid}`);
        session.processing = false;
        return;
      }

      const llmStart = Date.now();
      console.log(`[BELLA:LLM] Sending user message to Gemini: "${userText}"`);
      let response = await gemini.chat(userText);
      console.log(`[BELLA:LLM] Gemini responded in ${Date.now() - llmStart}ms`);

      let functionCalls = response.functionCalls?.();
      while (functionCalls && functionCalls.length > 0) {
        console.log(`[BELLA:LLM] Gemini requested ${functionCalls.length} tool call(s): ${functionCalls.map(fc => fc.name).join(', ')}`);
        const ctx: ToolContext = {
          sessionId: session.dbSessionId || session.id,
          callerPhone: session.callerPhone,
          customerId: session.customerId,
          claimId: session.claimId,
        };

        const toolResults: Array<{ name: string; response: object }> = [];

        for (const fc of functionCalls) {
          const args = (fc.args || {}) as Record<string, unknown>;
          console.log(`[BELLA:TOOL] Calling ${fc.name}(${JSON.stringify(args)})`);
          const toolStart = Date.now();
          const result = await executeTool(fc.name, args, ctx);
          console.log(`[BELLA:TOOL] ${fc.name} returned in ${Date.now() - toolStart}ms — result=${JSON.stringify(result).substring(0, 200)}`);

          session.conversationHistory.push({
            role: 'function',
            content: JSON.stringify(result),
            toolName: fc.name,
            toolInput: args,
            toolResult: result,
          });
          await this.saveTranscript(session, 'tool', JSON.stringify(result), fc.name, args, result);

          if (fc.name === 'open_claim') {
            const claimResult = result as { claimId?: string };
            if (claimResult.claimId) {
              session.claimId = claimResult.claimId;
            }
          }

          toolResults.push({ name: fc.name, response: result });
        }

        const toolReturnStart = Date.now();
        console.log(`[BELLA:LLM] Sending ${toolResults.length} tool result(s) back to Gemini`);
        response = await gemini.sendToolResults(toolResults);
        console.log(`[BELLA:LLM] Gemini processed tool results in ${Date.now() - toolReturnStart}ms`);
        functionCalls = response.functionCalls?.();
      }

      const agentText = response.text?.() || '';
      if (agentText) {
        console.log(`[BELLA:LLM] Gemini response: "${agentText.substring(0, 150)}${agentText.length > 150 ? '...' : ''}"`);
        session.conversationHistory.push({ role: 'model', content: agentText });
        await this.saveTranscript(session, 'agent', agentText);

        const ttsStart = Date.now();
        const ttsAudio = await gradium.textToSpeech(agentText);
        console.log(`[BELLA:TTS] TTS complete — ttsTime=${Date.now() - ttsStart}ms audioSize=${Math.ceil((ttsAudio.length * 3) / 4)}bytes`);
        this.sendAudioToTwilio(session, ttsAudio);
      }

      console.log(`[BELLA:SESSION] === Conversation turn end === callSid=${session.callSid} totalTime=${Date.now() - turnStart}ms`);
    } catch (err) {
      console.error(`[BELLA:SESSION] Conversation turn error — callSid=${session.callSid} elapsed=${Date.now() - turnStart}ms`, err);
      logger.error({ err, callSid: session.callSid }, 'Conversation turn error');
    } finally {
      session.processing = false;
    }
  }

  private async finalizeSession(session: Session): Promise<void> {
    if (!session.dbSessionId) return;

    try {
      console.log(`[BELLA:SESSION] Finalizing session — dbSessionId=${session.dbSessionId} historyLen=${session.conversationHistory.length}`);
      const db = getDb();
      const gemini = getGeminiClient();

      const historyText = session.conversationHistory
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const summary = historyText
        ? await gemini.generateSummary(historyText)
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
