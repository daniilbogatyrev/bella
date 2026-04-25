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
        logger.info({ callSid }, 'Twilio connected');
        break;
      case 'start':
        this.handleStart(session, message);
        break;
      case 'media':
        this.handleMedia(session, message);
        break;
      case 'mark':
        this.handleMark(session, message);
        break;
      case 'stop':
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

    logger.info(
      { streamSid: session.streamSid, callerPhone: session.callerPhone },
      'Stream started',
    );

    this.initializePipeline(session).catch((err) => {
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
      this.flushAudioBuffer(session);
    }
  }

  handleMark(session: Session, message: TwilioMarkEvent): void {
    session.lastMarkName = message.mark.name;
  }

  handleStop(session: Session): void {
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

      const gemini = getGeminiClient();
      gemini.startChat();
      this.geminiClients.set(session.callSid, gemini);

      const ctx: ToolContext = {
        sessionId: session.dbSessionId,
        callerPhone: session.callerPhone,
      };

      if (session.callerPhone) {
        const lookupResult = await executeTool('lookup_customer', { phone: session.callerPhone }, ctx);
        const lookup = lookupResult as { found: boolean; customer?: { id: string; firstName: string } };

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

      const response = await gemini.chat(greeting);
      const text = response.text?.() || 'Hi there! This is Bella from SafeGuard Insurance. How can I help you today?';

      session.conversationHistory.push({ role: 'model', content: text });
      await this.saveTranscript(session, 'agent', text);

      const gradium = getGradiumClient();
      const audioBase64 = await gradium.textToSpeech(text);
      this.sendAudioToTwilio(session, audioBase64);

      logger.info({ callSid: session.callSid }, 'Pipeline initialized with greeting');
    } catch (err) {
      logger.error({ err, callSid: session.callSid }, 'Pipeline init error');
    }
  }

  private flushAudioBuffer(session: Session): void {
    if (session.audioBuffer.length === 0) return;

    const combinedAudio = session.audioBuffer.join('');
    session.audioBuffer = [];
    session.audioBufferBytes = 0;

    this.processConversationTurn(session, combinedAudio).catch((err) => {
      logger.error({ err, callSid: session.callSid }, 'Conversation turn failed');
    });
  }

  private async processConversationTurn(session: Session, audioBase64: string): Promise<void> {
    if (session.processing || session.status !== 'active') return;
    session.processing = true;

    try {
      const gradium = getGradiumClient();
      const userText = await gradium.speechToText(audioBase64);

      if (!userText.trim()) {
        session.processing = false;
        return;
      }

      session.conversationHistory.push({ role: 'user', content: userText });
      await this.saveTranscript(session, 'customer', userText);

      const gemini = this.geminiClients.get(session.callSid);
      if (!gemini) {
        session.processing = false;
        return;
      }

      let response = await gemini.chat(userText);

      let functionCalls = response.functionCalls?.();
      while (functionCalls && functionCalls.length > 0) {
        const ctx: ToolContext = {
          sessionId: session.dbSessionId || session.id,
          callerPhone: session.callerPhone,
          customerId: session.customerId,
          claimId: session.claimId,
        };

        const toolResults: Array<{ name: string; response: object }> = [];

        for (const fc of functionCalls) {
          const args = (fc.args || {}) as Record<string, unknown>;
          const result = await executeTool(fc.name, args, ctx);

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

        response = await gemini.sendToolResults(toolResults);
        functionCalls = response.functionCalls?.();
      }

      const agentText = response.text?.() || '';
      if (agentText) {
        session.conversationHistory.push({ role: 'model', content: agentText });
        await this.saveTranscript(session, 'agent', agentText);

        const ttsAudio = await gradium.textToSpeech(agentText);
        this.sendAudioToTwilio(session, ttsAudio);
      }
    } catch (err) {
      logger.error({ err, callSid: session.callSid }, 'Conversation turn error');
    } finally {
      session.processing = false;
    }
  }

  private async finalizeSession(session: Session): Promise<void> {
    if (!session.dbSessionId) return;

    try {
      const db = getDb();
      const gemini = getGeminiClient();

      const historyText = session.conversationHistory
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const summary = historyText
        ? await gemini.generateSummary(historyText)
        : 'Call ended with no conversation.';

      await db
        .update(callSessions)
        .set({
          status: 'completed',
          endedAt: new Date(),
          summary,
          claimId: session.claimId || undefined,
        })
        .where(eq(callSessions.id, session.dbSessionId));

      logger.info({ sessionId: session.dbSessionId }, 'Session finalized');
    } catch (err) {
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
