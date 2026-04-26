import pino from 'pino';

const logger = pino({ name: 'bella-gradium' });

export interface GradiumConfig {
  apiKey: string;
  baseUrl: string;
  sttModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
}

/**
 * Decode a single μ-law encoded byte to a signed 16-bit linear PCM sample.
 *
 * Follows the ITU-T G.711 μ-law expansion algorithm:
 * 1. Complement the input byte
 * 2. Extract sign, exponent (3 bits), and mantissa (4 bits)
 * 3. Reconstruct the linear magnitude using `((mantissa << 3) + 0x84) << exponent - 0x84`
 *
 * @param mulaw - 8-bit μ-law encoded sample (0–255)
 * @returns Signed 16-bit linear PCM sample (−32,124 to +32,124)
 */
function mulawDecode(mulaw: number): number {
  mulaw = ~mulaw & 0xff;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0f;
  let sample = (mantissa << 3) + 0x84;
  sample <<= exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

/**
 * Convert base64-encoded μ-law 8 kHz audio to a PCM 24 kHz 16-bit mono Buffer.
 *
 * Pipeline:
 * 1. Base64-decode → raw μ-law bytes
 * 2. Expand each byte to a 16-bit linear PCM sample via {@link mulawDecode}
 * 3. Upsample 8 kHz → 24 kHz with 3× linear interpolation
 *
 * Size invariant (for N input bytes):
 *   - After decode: N × 2 bytes (N 16-bit samples at 8 kHz)
 *   - After upsample: N × 3 × 2 bytes (N×3 16-bit samples at 24 kHz)
 *
 * @param mulawBase64 - Base64-encoded μ-law 8 kHz audio (e.g. from Twilio)
 * @returns Buffer of PCM 24 kHz 16-bit little-endian mono audio
 */
function mulawToLinear24k(mulawBase64: string): Buffer {
  const mulawBytes = Buffer.from(mulawBase64, 'base64');

  const pcm8k = new Int16Array(mulawBytes.length);
  for (let i = 0; i < mulawBytes.length; i++) {
    pcm8k[i] = mulawDecode(mulawBytes[i]!);
  }

  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length - 1; i++) {
    const curr = pcm8k[i]!;
    const next = pcm8k[i + 1]!;
    pcm24k[i * 3] = curr;
    pcm24k[i * 3 + 1] = Math.round(curr + (next - curr) / 3);
    pcm24k[i * 3 + 2] = Math.round(curr + ((next - curr) * 2) / 3);
  }
  const last = pcm8k.length - 1;
  pcm24k[last * 3] = pcm8k[last]!;
  pcm24k[last * 3 + 1] = pcm8k[last]!;
  pcm24k[last * 3 + 2] = pcm8k[last]!;

  return Buffer.from(pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength);
}

/**
 * Build the WebSocket URL from the configured HTTP base URL.
 * Converts `https://` to `wss://` and `http://` to `ws://`.
 */
function toWsUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/^http/, 'ws') + path;
}

/**
 * Concatenate multiple base64-encoded audio chunks into a single base64 string.
 * Decodes each chunk to binary, concatenates the buffers, then re-encodes.
 */
function combineBase64Chunks(chunks: string[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0]!;
  const buffers = chunks.map(c => Buffer.from(c, 'base64'));
  return Buffer.concat(buffers).toString('base64');
}

/** Gradium STT recommends 1920 samples per frame (80 ms at 24 kHz). */
const STT_FRAME_SAMPLES = 1920;
/** 1920 samples × 2 bytes/sample = 3840 bytes per frame. */
const STT_FRAME_BYTES = STT_FRAME_SAMPLES * 2;

const STT_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;

/**
 * Client for Gradium AI speech-to-text and text-to-speech APIs.
 *
 * Uses the Gradium API as documented at https://docs.gradium.ai/api-reference/introduction
 * (OpenAPI spec: https://docs.gradium.ai/api-reference/openapi.json).
 *
 * **STT** — WebSocket at `wss://{host}/api/speech/asr`
 *   - Auth: `x-api-key` header (Bun extends W3C WebSocket with headers support)
 *   - Setup: `{type: "setup", model_name, input_format: "pcm"}`
 *   - Audio: `{type: "audio", audio: "<base64>"}` — PCM 24 kHz 16-bit mono, chunked into 1920-sample frames
 *   - Mulaw 8 kHz from Twilio is decoded and upsampled to PCM 24 kHz before sending
 *
 * **TTS** — WebSocket at `wss://{host}/api/speech/tts`
 *   - Auth: `x-api-key` header
 *   - Setup: `{type: "setup", voice_id, model_name, output_format: "ulaw_8000"}`
 *   - Text: `{type: "text", text: "..."}`
 *   - Audio returned as `{type: "audio", audio: "<base64>"}` in ulaw 8 kHz
 *
 * @example
 * ```ts
 * const client = new GradiumClient({ apiKey: '...', baseUrl: 'https://api.gradium.ai' });
 * const transcript = await client.speechToText(mulawBase64);
 * const audioOut = await client.textToSpeech('Hello!');
 * ```
 */
export class GradiumClient {
  private config: GradiumConfig;

  constructor(config: GradiumConfig) {
    this.config = config;
    logger.info({ baseUrl: config.baseUrl }, 'GradiumClient initialized');
  }

  /**
   * Transcribe base64-encoded mulaw 8 kHz audio to text via Gradium WebSocket STT.
   *
   * Opens a WebSocket to `wss://{baseUrl}/api/speech/asr`, sends a setup message
   * with `input_format: "pcm"`, converts mulaw 8 kHz → PCM 24 kHz, streams the
   * audio as base64-encoded JSON frames, then collects all `{type: "text"}`
   * responses until `end_of_stream`.
   *
   * @param audioBase64 - Base64-encoded mulaw 8 kHz audio from Twilio
   * @returns Transcribed text string
   * @throws Error if the WebSocket connection fails or the server returns an error
   */
  async speechToText(audioBase64: string): Promise<string> {
    const audioSizeBytes = Math.ceil((audioBase64.length * 3) / 4);
    console.log(`[BELLA:STT] Received ${audioSizeBytes} bytes mulaw audio, converting to PCM 24kHz for Gradium STT`);
    const start = Date.now();

    let pcm24kBuf = mulawToLinear24k(audioBase64);
    const expectedPcmBytes = audioSizeBytes * 6;
    if (pcm24kBuf.length !== expectedPcmBytes) {
      console.error(`[BELLA:STT] BUG: Expected ${expectedPcmBytes} PCM bytes, got ${pcm24kBuf.length}`);
    }
    console.log(`[BELLA:STT] Converted to PCM 24kHz — pcmSize=${pcm24kBuf.length}bytes elapsed=${Date.now() - start}ms`);

    if (process.env.AI_COUSTIC_ENABLED !== 'false' && process.env.AI_COUSTIC) {
      const { enhanceAudio } = await import('./aicoustics');
      pcm24kBuf = await enhanceAudio(pcm24kBuf);
    }

    const wsUrl = toWsUrl(this.config.baseUrl, '/api/speech/asr');
    const model = this.config.sttModel || 'default';

    return new Promise<string>((resolve, reject) => {
      const textParts: string[] = [];
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          console.error(`[BELLA:STT] Timeout after ${STT_TIMEOUT_MS}ms — elapsed=${Date.now() - start}ms`);
          reject(new Error(`Gradium STT timeout after ${STT_TIMEOUT_MS}ms`));
        }
      }, STT_TIMEOUT_MS);

      console.log(`[BELLA:STT] Connecting to ${wsUrl}`);
      const ws = new WebSocket(wsUrl, {
        headers: { 'x-api-key': this.config.apiKey },
      } as any);

      ws.onopen = () => {
        console.log(`[BELLA:STT] WebSocket connected — sending setup`);
        const setupMsg = {
          type: 'setup',
          model_name: model,
          input_format: 'pcm',
        };
        console.log(`[BELLA:STT] Setup message: ${JSON.stringify(setupMsg)}`);
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          const msg = JSON.parse(raw);
          console.log(`[BELLA:STT] ← ${msg.type}${msg.type === 'text' ? ` text="${msg.text}"` : ''}${msg.type === 'error' ? ` message="${msg.message}" code=${msg.code}` : ''}${msg.type === 'ready' ? ` request_id=${msg.request_id} sample_rate=${msg.sample_rate} frame_size=${msg.frame_size}` : ''}`);

          if (msg.type === 'ready') {
            const totalFrames = Math.ceil(pcm24kBuf.length / STT_FRAME_BYTES);
            console.log(`[BELLA:STT] Server ready — streaming ${pcm24kBuf.length} bytes as ${totalFrames} frames of ${STT_FRAME_BYTES} bytes`);

            for (let offset = 0; offset < pcm24kBuf.length; offset += STT_FRAME_BYTES) {
              const end = Math.min(offset + STT_FRAME_BYTES, pcm24kBuf.length);
              const chunk = pcm24kBuf.subarray(offset, end);
              const b64 = Buffer.from(chunk).toString('base64');
              ws.send(JSON.stringify({ type: 'audio', audio: b64 }));
            }
            console.log(`[BELLA:STT] All ${totalFrames} audio frames sent — sending end_of_stream`);
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          } else if (msg.type === 'text') {
            if (msg.text) textParts.push(msg.text);
          } else if (msg.type === 'end_of_stream') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              const transcript = textParts.join(' ').trim();
              console.log(`[BELLA:STT] STT result: "${transcript}" elapsed=${Date.now() - start}ms`);
              resolve(transcript);
            }
          } else if (msg.type === 'error') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              console.error(`[BELLA:STT] STT error — message=${msg.message} code=${msg.code} elapsed=${Date.now() - start}ms`);
              logger.error({ message: msg.message, code: msg.code }, 'STT WebSocket error');
              reject(new Error(`Gradium STT error: ${msg.message} (code ${msg.code})`));
            }
          }
        } catch (parseErr) {
          console.error(`[BELLA:STT] Failed to parse message:`, parseErr);
          logger.warn({ parseErr }, 'Failed to parse STT WebSocket message');
        }
      };

      ws.onerror = (event: Event) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          const errMsg = 'message' in event ? String((event as ErrorEvent).message) : 'WebSocket connection failed';
          console.error(`[BELLA:STT] WebSocket error — elapsed=${Date.now() - start}ms error=${errMsg}`);
          logger.error({ error: errMsg }, 'STT WebSocket connection error');
          reject(new Error(`Gradium STT WebSocket error: ${errMsg}`));
        }
      };

      ws.onclose = (event: CloseEvent) => {
        console.log(`[BELLA:STT] WebSocket closed — code=${event.code} reason="${event.reason}" wasClean=${event.wasClean} elapsed=${Date.now() - start}ms`);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          const transcript = textParts.join(' ').trim();
          if (transcript) {
            console.log(`[BELLA:STT] WebSocket closed with partial result: "${transcript}"`);
            resolve(transcript);
          } else {
            console.error(`[BELLA:STT] WebSocket closed unexpectedly with no transcript`);
            reject(new Error(`Gradium STT WebSocket closed: code=${event.code} reason=${event.reason}`));
          }
        }
      };
    });
  }

  /**
   * Convert text to base64-encoded mulaw 8 kHz audio for Twilio playback.
   *
   * Uses the Gradium TTS WebSocket endpoint at `wss://{baseUrl}/api/speech/tts`
   * with `output_format: "ulaw_8000"` which directly outputs mulaw-encoded 8 kHz
   * audio matching Twilio's expected playback format.
   *
   * @param text - Text to synthesize
   * @returns Base64-encoded mulaw 8 kHz audio ready for Twilio
   * @throws Error if the WebSocket connection fails or the server returns an error
   */
  async textToSpeech(text: string): Promise<string> {
    console.log(`[BELLA:TTS] Sending text to Gradium TTS — textLen=${text.length} text="${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
    const start = Date.now();

    const wsUrl = toWsUrl(this.config.baseUrl, '/api/speech/tts');
    const voice = this.config.ttsVoice || 'YTpq7expH9539ERJ';
    const model = this.config.ttsModel || 'default';

    return new Promise<string>((resolve, reject) => {
      const audioChunks: string[] = [];
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          console.error(`[BELLA:TTS] Timeout after ${TTS_TIMEOUT_MS}ms — elapsed=${Date.now() - start}ms`);
          reject(new Error(`Gradium TTS timeout after ${TTS_TIMEOUT_MS}ms`));
        }
      }, TTS_TIMEOUT_MS);

      console.log(`[BELLA:TTS] Connecting to ${wsUrl}`);
      const ws = new WebSocket(wsUrl, {
        headers: { 'x-api-key': this.config.apiKey },
      } as any);

      ws.onopen = () => {
        console.log(`[BELLA:TTS] WebSocket connected — sending setup`);
        const setupMsg = {
          type: 'setup',
          voice_id: voice,
          model_name: model,
          output_format: 'ulaw_8000',
        };
        console.log(`[BELLA:TTS] Setup message: ${JSON.stringify(setupMsg)}`);
        ws.send(JSON.stringify(setupMsg));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          const msg = JSON.parse(raw);

          if (msg.type === 'ready') {
            console.log(`[BELLA:TTS] ← ready request_id=${msg.request_id}`);
            console.log(`[BELLA:TTS] Server ready — sending text`);
            ws.send(JSON.stringify({ type: 'text', text }));
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          } else if (msg.type === 'audio' && msg.audio) {
            audioChunks.push(msg.audio);
          } else if (msg.type === 'end_of_stream') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              const combined = combineBase64Chunks(audioChunks);
              const audioSize = Math.ceil((combined.length * 3) / 4);
              console.log(`[BELLA:TTS] TTS complete — chunks=${audioChunks.length} audioSize=${audioSize}bytes elapsed=${Date.now() - start}ms`);
              resolve(combined);
            }
          } else if (msg.type === 'error') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              console.error(`[BELLA:TTS] TTS error — message=${msg.message} code=${msg.code} elapsed=${Date.now() - start}ms`);
              logger.error({ message: msg.message, code: msg.code }, 'TTS WebSocket error');
              reject(new Error(`Gradium TTS error: ${msg.message} (code ${msg.code})`));
            }
          }
        } catch (parseErr) {
          console.error(`[BELLA:TTS] Failed to parse message:`, parseErr);
          logger.warn({ parseErr }, 'Failed to parse TTS WebSocket message');
        }
      };

      ws.onerror = (event: Event) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          const errMsg = 'message' in event ? String((event as ErrorEvent).message) : 'WebSocket connection failed';
          console.error(`[BELLA:TTS] WebSocket error — elapsed=${Date.now() - start}ms error=${errMsg}`);
          logger.error({ error: errMsg }, 'TTS WebSocket connection error');
          reject(new Error(`Gradium TTS WebSocket error: ${errMsg}`));
        }
      };

      ws.onclose = (event: CloseEvent) => {
        console.log(`[BELLA:TTS] WebSocket closed — code=${event.code} reason="${event.reason}" wasClean=${event.wasClean} elapsed=${Date.now() - start}ms`);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          if (audioChunks.length > 0) {
            const combined = combineBase64Chunks(audioChunks);
            console.log(`[BELLA:TTS] WebSocket closed with partial audio — chunks=${audioChunks.length} code=${event.code}`);
            resolve(combined);
          } else {
            console.error(`[BELLA:TTS] WebSocket closed with no audio`);
            reject(new Error(`Gradium TTS WebSocket closed: code=${event.code} reason=${event.reason}`));
          }
        }
      };
    });
  }
}

/**
 * TTS abstraction that maintains a persistent WebSocket to Gradium.
 *
 * One TCP+TLS+WS connection is opened via `connect()` and reused for all
 * `synthesize()` calls within a call session. Setup is sent before each
 * synthesis (Gradium resets its internal session after every `end_of_stream`),
 * but the underlying transport stays open — avoiding the ~200ms handshake
 * overhead on every turn.
 *
 * If the server drops the connection between calls, `synthesize()` detects
 * the stale socket and transparently reconnects before proceeding.
 *
 * Important protocol notes (learned from production):
 * - Do NOT send `client_req_id` on any message — causes "Session not found"
 * - Do NOT send `close_ws_on_eos` — let the server decide; detect + reconnect
 *   if it closes the socket after a synthesis
 *
 * @example
 * ```ts
 * const stream = new GradiumTTSStream(config);
 * await stream.connect();                     // opens persistent WS
 * const audio1 = await stream.synthesize('Hello!');          // reuses WS
 * const audio2 = await stream.synthesize('How can I help?'); // reuses WS
 * stream.close();                             // tears down WS
 * ```
 */
export class GradiumTTSStream {
  private config: GradiumConfig;
  private closed = false;
  private requestCounter = 0;

  /** The persistent WebSocket kept open across synthesize() calls. */
  private ws: WebSocket | null = null;

  /** Timeout handle for the currently in-flight synthesis. */
  private synthTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GradiumConfig) {
    this.config = config;
  }

  /**
   * Open the persistent WebSocket connection to Gradium TTS.
   *
   * Establishes the TCP+TLS+WS handshake once. Does NOT send a setup message
   * — that happens at the start of each `synthesize()` call.
   *
   * Safe to call multiple times; subsequent calls reconnect if the socket is
   * no longer open.
   */
  async connect(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error('GradiumTTSStream: apiKey is required');
    }
    this.closed = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[BELLA:TTS-STREAM] Already connected (persistent)`);
      return;
    }

    await this.openWebSocket();
  }

  /**
   * Open a new WebSocket and wait for the `open` event.
   * Replaces any existing socket reference.
   */
  private openWebSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = toWsUrl(this.config.baseUrl, '/api/speech/tts');
      console.log(`[BELLA:TTS-STREAM] Connecting to ${wsUrl}`);

      const ws = new WebSocket(wsUrl, {
        headers: { 'x-api-key': this.config.apiKey },
      } as any);

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('GradiumTTSStream: connection timeout'));
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        console.log(`[BELLA:TTS-STREAM] Connected (persistent)`);
        resolve();
      };

      ws.onerror = (event: Event) => {
        clearTimeout(connectTimeout);
        const errMsg = 'message' in event ? String((event as ErrorEvent).message) : 'WebSocket connection failed';
        console.error(`[BELLA:TTS-STREAM] Connection error — ${errMsg}`);
        reject(new Error(`GradiumTTSStream: connection error: ${errMsg}`));
      };

      ws.onclose = (event: CloseEvent) => {
        clearTimeout(connectTimeout);
        if (this.ws === ws) {
          this.ws = null;
        }
        console.log(`[BELLA:TTS-STREAM] WebSocket closed — code=${event.code} reason="${event.reason}"`);
      };
    });
  }

  /** Check whether the persistent WebSocket is currently open. */
  private isWsOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Ensure the persistent WebSocket is open, reconnecting if necessary.
   * Returns the live socket.
   */
  private async ensureConnected(): Promise<WebSocket> {
    if (this.isWsOpen()) return this.ws!;

    console.log(`[BELLA:TTS-STREAM] Reconnecting...`);
    await this.openWebSocket();
    return this.ws!;
  }

  /**
   * Synthesize text to base64-encoded mulaw 8 kHz audio.
   *
   * Reuses the persistent WebSocket. Sends setup → waits for ready →
   * sends text + end_of_stream → collects audio chunks until the server
   * replies with its own `end_of_stream`. Does NOT close the socket
   * afterward — it stays open for the next call.
   *
   * Only one synthesis can be in flight at a time.
   *
   * @param text - Text to synthesize
   * @returns Base64-encoded mulaw 8 kHz audio ready for Twilio
   */
  async synthesize(text: string): Promise<string> {
    if (this.closed) throw new Error('GradiumTTSStream: stream is closed');

    this.requestCounter++;
    const reqId = `tts-${this.requestCounter}`;
    const start = Date.now();
    const voice = this.config.ttsVoice || 'YTpq7expH9539ERJ';
    const model = this.config.ttsModel || 'default';

    console.log(`[BELLA:TTS-STREAM] Synthesizing — reqId=${reqId} (reusing connection) textLen=${text.length} text="${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    const ws = await this.ensureConnected();

    return new Promise<string>((resolve, reject) => {
      const audioChunks: string[] = [];
      let settled = false;

      const settle = () => {
        if (settled) return;
        settled = true;
        if (this.synthTimeout) {
          clearTimeout(this.synthTimeout);
          this.synthTimeout = null;
        }
        // Restore the idle onmessage/onerror/onclose handlers
        this.installIdleHandlers(ws);
      };

      this.synthTimeout = setTimeout(() => {
        if (!settled) {
          settle();
          console.error(`[BELLA:TTS-STREAM] Synthesis timeout — reqId=${reqId} elapsed=${Date.now() - start}ms`);
          reject(new Error(`GradiumTTSStream: synthesis timeout after ${TTS_TIMEOUT_MS}ms`));
        }
      }, TTS_TIMEOUT_MS);

      ws.onmessage = (event: MessageEvent) => {
        if (settled) return;
        try {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          const msg = JSON.parse(raw);

          if (msg.type === 'ready') {
            console.log(`[BELLA:TTS-STREAM] ← ready — reqId=${reqId}, sending text`);
            ws.send(JSON.stringify({ type: 'text', text }));
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          } else if (msg.type === 'audio' && msg.audio) {
            audioChunks.push(msg.audio);
          } else if (msg.type === 'end_of_stream') {
            const combined = combineBase64Chunks(audioChunks);
            const audioSize = Math.ceil((combined.length * 3) / 4);
            console.log(`[BELLA:TTS-STREAM] Synthesis complete — reqId=${reqId} chunks=${audioChunks.length} audioSize=${audioSize}bytes elapsed=${Date.now() - start}ms`);
            settle();
            resolve(combined);
          } else if (msg.type === 'error') {
            console.error(`[BELLA:TTS-STREAM] Server error — reqId=${reqId} message=${msg.message} code=${msg.code}`);
            settle();
            reject(new Error(`GradiumTTSStream: server error: ${msg.message} (code ${msg.code})`));
          }
        } catch (parseErr) {
          console.error(`[BELLA:TTS-STREAM] Failed to parse message:`, parseErr);
          logger.warn({ parseErr }, 'Failed to parse TTS stream message');
        }
      };

      ws.onerror = (event: Event) => {
        if (settled) return;
        const errMsg = 'message' in event ? String((event as ErrorEvent).message) : 'WebSocket error';
        console.error(`[BELLA:TTS-STREAM] WebSocket error during synthesis — reqId=${reqId} error=${errMsg}`);
        logger.error({ error: errMsg, reqId }, 'TTS stream WebSocket error');
        settle();
        this.ws = null;
        reject(new Error(`GradiumTTSStream: WebSocket error: ${errMsg}`));
      };

      ws.onclose = (event: CloseEvent) => {
        if (this.ws === ws) this.ws = null;
        console.log(`[BELLA:TTS-STREAM] WebSocket closed during synthesis — reqId=${reqId} code=${event.code} reason="${event.reason}"`);
        if (!settled) {
          settle();
          if (audioChunks.length > 0) {
            const combined = combineBase64Chunks(audioChunks);
            console.log(`[BELLA:TTS-STREAM] Returning partial audio — reqId=${reqId} chunks=${audioChunks.length}`);
            resolve(combined);
          } else {
            reject(new Error(`GradiumTTSStream: WebSocket closed unexpectedly: code=${event.code} reason=${event.reason}`));
          }
        }
      };

      // Send setup to start a new synthesis session on the existing connection
      const setupMsg = {
        type: 'setup',
        voice_id: voice,
        model_name: model,
        output_format: 'ulaw_8000',
      };
      ws.send(JSON.stringify(setupMsg));
    });
  }

  /**
   * Install minimal handlers on the persistent socket while no synthesis is
   * in flight. Detects server-initiated closes so `ensureConnected()` knows
   * to reconnect on the next call.
   */
  private installIdleHandlers(ws: WebSocket): void {
    ws.onmessage = () => {};
    ws.onerror = () => {};
    ws.onclose = (event: CloseEvent) => {
      if (this.ws === ws) {
        this.ws = null;
        console.log(`[BELLA:TTS-STREAM] Persistent WS closed while idle — code=${event.code}`);
      }
    };
  }

  /** Close the persistent WebSocket and prevent future calls. */
  close(): void {
    this.closed = true;

    if (this.synthTimeout) {
      clearTimeout(this.synthTimeout);
      this.synthTimeout = null;
    }

    if (this.ws) {
      console.log(`[BELLA:TTS-STREAM] Closed`);
      this.ws.close();
      this.ws = null;
    }
  }

  /** Whether the persistent WebSocket is currently open. */
  get isConnected(): boolean {
    return this.isWsOpen();
  }
}

/**
 * Create a new TTS stream using the global Gradium config.
 *
 * Caller should `await stream.connect()` to open the persistent WebSocket,
 * then call `stream.synthesize(text)` for each turn. Call `stream.close()`
 * when the session ends.
 */
export function createTTSStream(): GradiumTTSStream {
  const apiKey = process.env.GRADIUM_API_KEY;
  if (!apiKey) throw new Error('GRADIUM_API_KEY is required');
  return new GradiumTTSStream({
    apiKey,
    baseUrl: process.env.GRADIUM_BASE_URL || 'https://api.gradium.ai',
  });
}

let client: GradiumClient | null = null;

/**
 * Get or create the singleton GradiumClient instance.
 *
 * @throws Error if GRADIUM_API_KEY environment variable is not set
 */
export function getGradiumClient(): GradiumClient {
  if (!client) {
    const apiKey = process.env.GRADIUM_API_KEY;
    if (!apiKey) throw new Error('GRADIUM_API_KEY is required');
    client = new GradiumClient({
      apiKey,
      baseUrl: process.env.GRADIUM_BASE_URL || 'https://api.gradium.ai',
    });
  }
  return client;
}

/** Reset the singleton (for testing). */
export function resetGradiumClient(): void {
  client = null;
}
