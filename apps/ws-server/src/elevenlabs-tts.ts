import pino from 'pino';
import type { TTSStream } from './types';

const logger = pino({ name: 'bella-tts-11labs' });

const LOG_PREFIX = '[BELLA:TTS:11LABS]';

const DEFAULT_VOICE_ID = '9BWtsMINqrJLrRacOk9x'; // Aria — natural, warm female voice
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';
const WS_BASE_URL = 'wss://api.elevenlabs.io/v1/text-to-speech';
const SYNTH_TIMEOUT_MS = 30_000;

interface ElevenLabsTTSConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

/**
 * ElevenLabs WebSocket-based TTS stream that implements the TTSStream interface.
 *
 * Uses the ElevenLabs streaming input endpoint to send text and receive
 * base64-encoded μ-law 8 kHz audio chunks suitable for Twilio.
 *
 * The WebSocket connection is opened once via `connect()` and reused across
 * multiple `synthesize()` calls within a session. Call `close()` when done.
 */
export class ElevenLabsTTSStream implements TTSStream {
  private ws: WebSocket | null = null;
  private closed = false;
  private readonly config: ElevenLabsTTSConfig;
  private synthTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ElevenLabsTTSConfig) {
    this.config = config;
  }

  private isWsOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Build the WebSocket URL with query parameters for voice, model, and output format.
   * Uses ulaw_8000 output for direct Twilio compatibility (no conversion needed).
   */
  private buildWsUrl(): string {
    const params = new URLSearchParams({
      model_id: this.config.modelId,
      output_format: 'ulaw_8000',
    });
    return `${WS_BASE_URL}/${this.config.voiceId}/stream-input?${params.toString()}`;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error(`${LOG_PREFIX} Stream already closed`);
    if (this.isWsOpen()) return;

    const url = this.buildWsUrl();
    console.log(`${LOG_PREFIX} Connecting — voiceId=${this.config.voiceId} model=${this.config.modelId}`);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      } as unknown as string[]);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`${LOG_PREFIX} Connection timed out`));
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.ws = ws;

        // Send initial BOS (beginning of stream) message
        const bos = JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          xi_api_key: this.config.apiKey,
        });
        ws.send(bos);

        this.installIdleHandlers(ws);
        console.log(`${LOG_PREFIX} Connected`);
        logger.info('ElevenLabs TTS WebSocket connected');
        resolve();
      };

      ws.onerror = (event: Event) => {
        clearTimeout(timeout);
        const errMsg = 'message' in event ? String((event as ErrorEvent).message) : 'WebSocket error';
        console.error(`${LOG_PREFIX} Connection error: ${errMsg}`);
        logger.error({ error: errMsg }, 'ElevenLabs TTS connection error');
        reject(new Error(`${LOG_PREFIX} Connection error: ${errMsg}`));
      };

      ws.onclose = (event: CloseEvent) => {
        clearTimeout(timeout);
        if (!this.isWsOpen()) {
          reject(new Error(`${LOG_PREFIX} Connection closed before open: code=${event.code} reason=${event.reason}`));
        }
      };
    });
  }

  /**
   * Ensure we have a live WebSocket connection, reconnecting if needed.
   */
  private async ensureConnected(): Promise<WebSocket> {
    if (this.closed) throw new Error(`${LOG_PREFIX} Stream is closed`);
    if (!this.isWsOpen()) {
      console.log(`${LOG_PREFIX} Reconnecting (was disconnected)`);
      await this.connect();
    }
    return this.ws!;
  }

  async synthesize(text: string): Promise<string> {
    if (!text.trim()) return '';

    const ws = await this.ensureConnected();
    const reqId = crypto.randomUUID().substring(0, 8);
    const truncated = text.length > 80 ? text.substring(0, 80) + '...' : text;
    console.log(`${LOG_PREFIX} Synthesize start — reqId=${reqId} text="${truncated}"`);

    return new Promise<string>((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      let settled = false;

      const settle = () => {
        settled = true;
        if (this.synthTimeout) {
          clearTimeout(this.synthTimeout);
          this.synthTimeout = null;
        }
      };

      this.synthTimeout = setTimeout(() => {
        if (!settled) {
          settle();
          console.error(`${LOG_PREFIX} Synthesis timed out — reqId=${reqId}`);
          if (audioChunks.length > 0) {
            const combined = Buffer.concat(audioChunks).toString('base64');
            console.log(`${LOG_PREFIX} Returning partial audio on timeout — reqId=${reqId} chunks=${audioChunks.length}`);
            resolve(combined);
          } else {
            reject(new Error(`${LOG_PREFIX} Synthesis timed out with no audio`));
          }
        }
      }, SYNTH_TIMEOUT_MS);

      ws.onmessage = (event: MessageEvent) => {
        if (settled) return;

        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

          if (msg.audio) {
            const chunk = Buffer.from(msg.audio, 'base64');
            audioChunks.push(chunk);
          }

          if (msg.isFinal) {
            settle();
            const combined = Buffer.concat(audioChunks).toString('base64');
            const totalBytes = audioChunks.reduce((sum, b) => sum + b.length, 0);
            console.log(`${LOG_PREFIX} Synthesize complete — reqId=${reqId} chunks=${audioChunks.length} bytes=${totalBytes}`);
            logger.info({ reqId, chunks: audioChunks.length, bytes: totalBytes }, 'Synthesis complete');

            this.installIdleHandlers(ws);
            resolve(combined);
          }

          if (msg.error) {
            settle();
            console.error(`${LOG_PREFIX} Server error — reqId=${reqId} error=${JSON.stringify(msg.error)}`);
            this.installIdleHandlers(ws);
            reject(new Error(`${LOG_PREFIX} Server error: ${JSON.stringify(msg.error)}`));
          }
        } catch (parseErr) {
          console.error(`${LOG_PREFIX} Failed to parse message:`, parseErr);
          logger.warn({ parseErr }, 'Failed to parse TTS message');
        }
      };

      ws.onerror = (event: Event) => {
        if (settled) return;
        const errMsg = 'message' in event ? String((event as ErrorEvent).message) : 'WebSocket error';
        console.error(`${LOG_PREFIX} WebSocket error during synthesis — reqId=${reqId} error=${errMsg}`);
        logger.error({ error: errMsg, reqId }, 'TTS WebSocket error');
        settle();
        this.ws = null;
        reject(new Error(`${LOG_PREFIX} WebSocket error: ${errMsg}`));
      };

      ws.onclose = (event: CloseEvent) => {
        if (this.ws === ws) this.ws = null;
        console.log(`${LOG_PREFIX} WebSocket closed during synthesis — reqId=${reqId} code=${event.code} reason="${event.reason}"`);
        if (!settled) {
          settle();
          if (audioChunks.length > 0) {
            const combined = Buffer.concat(audioChunks).toString('base64');
            console.log(`${LOG_PREFIX} Returning partial audio — reqId=${reqId} chunks=${audioChunks.length}`);
            resolve(combined);
          } else {
            reject(new Error(`${LOG_PREFIX} WebSocket closed unexpectedly: code=${event.code} reason=${event.reason}`));
          }
        }
      };

      // Send the text for synthesis, then send EOS (end of stream) to flush
      ws.send(JSON.stringify({
        text: text,
        try_trigger_generation: true,
      }));

      ws.send(JSON.stringify({
        text: '',
      }));
    });
  }

  /**
   * Install minimal handlers on the WebSocket while no synthesis is in flight.
   */
  private installIdleHandlers(ws: WebSocket): void {
    ws.onmessage = () => {};
    ws.onerror = () => {};
    ws.onclose = (event: CloseEvent) => {
      if (this.ws === ws) {
        this.ws = null;
        console.log(`${LOG_PREFIX} Persistent WS closed while idle — code=${event.code}`);
      }
    };
  }

  close(): void {
    this.closed = true;

    if (this.synthTimeout) {
      clearTimeout(this.synthTimeout);
      this.synthTimeout = null;
    }

    if (this.ws) {
      console.log(`${LOG_PREFIX} Closed`);
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.isWsOpen();
  }
}

/**
 * Create a new ElevenLabs TTS stream using environment configuration.
 *
 * Caller should `await stream.connect()` to open the WebSocket,
 * then call `stream.synthesize(text)` for each turn.
 * Call `stream.close()` when the session ends.
 */
export function createElevenLabsTTSStream(): ElevenLabsTTSStream {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required for ElevenLabs TTS');

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_MODEL_ID;

  console.log(`${LOG_PREFIX} Creating stream — voiceId=${voiceId} model=${modelId}`);

  return new ElevenLabsTTSStream({ apiKey, voiceId, modelId });
}

/** Return the name of the default ElevenLabs voice ID. */
export function getDefaultVoiceId(): string {
  return DEFAULT_VOICE_ID;
}
