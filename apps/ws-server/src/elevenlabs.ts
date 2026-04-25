import pino from 'pino';
import type { ElevenLabsSTTStream } from './types';

const logger = pino({ name: 'bella-elevenlabs' });
const wsLogger = pino({ name: 'bella-elevenlabs-ws' });

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

/** WAV format tag for μ-law encoded audio (ITU-T G.711). */
const WAV_FORMAT_MULAW = 7;

/** WAV format tag for uncompressed linear PCM. */
const WAV_FORMAT_PCM = 1;

/**
 * Decode a single μ-law byte to a signed 16-bit linear PCM sample (ITU-T G.711).
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
 * Pipeline: Base64 → raw μ-law → 16-bit PCM 8 kHz → 3× linear interpolation → PCM 24 kHz.
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

  const outBuf = Buffer.from(pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength);
  const expectedBytes = mulawBytes.length * 6; // N mulaw → N×3 samples × 2 bytes
  const ok = outBuf.length === expectedBytes ? '✓' : '✗ MISMATCH';
  console.log(
    `[BELLA:STT:11LABS] mulawToLinear24k — ${mulawBytes.length} mulaw bytes → ` +
      `expected ${expectedBytes} PCM bytes, got ${outBuf.length} ${ok}`,
  );

  return outBuf;
}

/**
 * Build a WAV container for PCM 16-bit mono audio at the given sample rate.
 *
 * @param pcmBuffer - Raw PCM 16-bit LE samples
 * @param sampleRate - Sample rate in Hz (e.g. 24000)
 * @returns WAV Buffer with format tag 1 (PCM)
 */
function pcmToWav(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const dataSize = pcmBuffer.length;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const headerSize = 44;

  const wav = Buffer.alloc(headerSize + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(WAV_FORMAT_PCM, 20);
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, headerSize);

  return wav;
}

/**
 * Wrap raw mulaw 8 kHz bytes in a WAV container using format tag 7 (μ-law).
 *
 * This avoids decoding mulaw→PCM on our side — the raw Twilio mulaw bytes go
 * straight into the WAV data chunk. ElevenLabs' `scribe_v1` natively supports
 * WAV-wrapped mulaw, so this is both simpler and avoids any decode artifacts.
 *
 * WAV header: RIFF + WAVE + fmt (mulaw, 8kHz, mono, 8-bit) + data.
 *
 * @param mulawBase64 - Base64-encoded mulaw 8 kHz audio from Twilio
 * @returns WAV buffer with mulaw-encoded audio
 */
function mulawBase64ToWav(mulawBase64: string): Buffer {
  const mulawBytes = Buffer.from(mulawBase64, 'base64');
  const dataSize = mulawBytes.length;

  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  // Non-PCM formats (format tag != 1) require an extra cbSize field (2 bytes)
  // in the fmt chunk per the Microsoft RIFF/WAV spec. fmt chunk data = 18.
  const fmtChunkSize = 18;
  const headerSize = 12 + 8 + fmtChunkSize + 8; // RIFF(12) + fmt hdr(8) + fmt data(18) + data hdr(8) = 46

  const wav = Buffer.alloc(headerSize + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(headerSize - 8 + dataSize, 4); // file size minus 8
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(fmtChunkSize, 16);         // fmt chunk size = 18 for non-PCM
  wav.writeUInt16LE(WAV_FORMAT_MULAW, 20);     // format tag 7 = μ-law
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.writeUInt16LE(0, 36);                    // cbSize = 0 (no extra format data)
  wav.write('data', 38);
  wav.writeUInt32LE(dataSize, 42);
  mulawBytes.copy(wav, headerSize);

  return wav;
}

/** ElevenLabs STT response shape from the `scribe_v1` model. */
interface ElevenLabsSTTResponse {
  text?: string;
  language_code?: string;
  language_probability?: number;
  words?: Array<{
    text: string;
    start: number;
    end: number;
    type: string;
    speaker_id?: string;
  }>;
}

/**
 * Build the WAV buffer to send to ElevenLabs.
 *
 * When ai-coustics is enabled (`AI_COUSTIC_ENABLED !== 'false'` and `AI_COUSTIC` is set),
 * the pipeline is: mulaw 8 kHz → PCM 24 kHz → ai-coustics enhance → PCM WAV (24 kHz, 16-bit).
 * If enhancement fails, falls back to the raw mulaw WAV path.
 *
 * When ai-coustics is disabled, wraps raw mulaw bytes in a WAV container (format tag 7).
 */
async function buildWavForElevenLabs(
  audioBase64: string,
): Promise<{ wavBuf: Buffer; enhanced: boolean }> {
  if (process.env.AI_COUSTIC_ENABLED !== 'false' && process.env.AI_COUSTIC) {
    try {
      const { enhanceAudio } = await import('./aicoustics');
      const pcm24kBuf = mulawToLinear24k(audioBase64);
      const enhancedPcm = await enhanceAudio(pcm24kBuf);

      const enhancedSamples = enhancedPcm.length / 2;
      const durationSec = (enhancedSamples / 24_000).toFixed(2);
      console.log(
        `[BELLA:STT:11LABS] Enhanced PCM — ${enhancedPcm.length}bytes ` +
          `(${enhancedSamples}samples, ~${durationSec}s at 24kHz)`,
      );

      const wavBuf = pcmToWav(enhancedPcm, 24_000);
      console.log(
        `[BELLA:STT:11LABS] Using ai-coustics enhanced audio — wavSize=${wavBuf.length}bytes ` +
          `pcmSize=${enhancedPcm.length}bytes sampleRate=24000`,
      );
      return { wavBuf, enhanced: true };
    } catch (err) {
      console.error('[BELLA:STT:11LABS] ai-coustics enhancement failed, falling back to raw mulaw WAV', err);
      logger.warn({ err }, 'ai-coustics enhancement failed for ElevenLabs path — using raw mulaw');
    }
  }

  const wavBuf = mulawBase64ToWav(audioBase64);
  const mulawSize = Math.ceil((audioBase64.length * 3) / 4);
  console.log(
    `[BELLA:STT:11LABS] Using raw mulaw audio (no enhancement) — ` +
      `mulawSize=${mulawSize}bytes wavSize=${wavBuf.length}bytes ` +
      `(header=${wavBuf.length - mulawSize}bytes + data=${mulawSize}bytes)`,
  );
  return { wavBuf, enhanced: false };
}

/**
 * Transcribe base64-encoded mulaw 8 kHz audio to text via the ElevenLabs STT REST API.
 *
 * When ai-coustics is enabled, the audio is decoded to PCM 24 kHz, enhanced, and wrapped
 * in a PCM WAV before sending. Otherwise the raw mulaw bytes are wrapped in a mulaw WAV
 * (format tag 7) and sent directly — ElevenLabs handles the codec conversion server-side.
 *
 * @param audioBase64 - Base64-encoded mulaw 8 kHz audio from Twilio
 * @returns Transcribed text string
 */
export async function elevenLabsSpeechToText(audioBase64: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required');

  const start = Date.now();
  const mulawBytes = Math.ceil((audioBase64.length * 3) / 4);
  const durationSec = (mulawBytes / 8000).toFixed(2);
  console.log(
    `[BELLA:STT:11LABS] Received ${mulawBytes} bytes mulaw audio ` +
      `(~${durationSec}s at 8kHz mono)`,
  );

  const { wavBuf, enhanced } = await buildWavForElevenLabs(audioBase64);
  const conversionMs = Date.now() - start;
  console.log(
    `[BELLA:STT:11LABS] WAV created — size=${wavBuf.length}bytes ` +
      `enhanced=${enhanced} duration=~${durationSec}s conversionTime=${conversionMs}ms`,
  );

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(wavBuf)], { type: 'audio/wav' }), 'audio.wav');
  formData.append('model_id', 'scribe_v1');
  formData.append('language_code', 'en');

  console.log(`[BELLA:STT:11LABS] Sending to ElevenLabs STT API — model=scribe_v1 language=en`);
  const apiStart = Date.now();
  const response = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
  });

  const apiMs = Date.now() - apiStart;

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[BELLA:STT:11LABS] API error — status=${response.status} body=${errorBody} ` +
        `apiTime=${apiMs}ms totalTime=${Date.now() - start}ms`,
    );
    logger.error({ status: response.status, body: errorBody }, 'ElevenLabs STT error');
    throw new Error(`ElevenLabs STT error: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as ElevenLabsSTTResponse;
  const transcript = (data.text || '').trim();
  const totalMs = Date.now() - start;

  console.log(
    `[BELLA:STT:11LABS] Response — text="${transcript}" ` +
      `enhanced=${enhanced} ` +
      `language=${data.language_code || 'unknown'} ` +
      `languageProb=${data.language_probability?.toFixed(3) ?? 'N/A'} ` +
      `words=${data.words?.length ?? 0} ` +
      `apiTime=${apiMs}ms totalTime=${totalMs}ms`,
  );
  logger.info(
    {
      transcript,
      enhanced,
      language: data.language_code,
      languageProbability: data.language_probability,
      wordCount: data.words?.length ?? 0,
      apiMs,
      totalMs,
    },
    'ElevenLabs STT complete',
  );

  return transcript;
}

// ---------------------------------------------------------------------------
//  SDK-based real-time STT (streaming via @elevenlabs/elevenlabs-js)
// ---------------------------------------------------------------------------

import {
  ElevenLabsClient,
  AudioFormat,
  CommitStrategy,
  RealtimeEvents,
  type RealtimeConnection,
} from '@elevenlabs/elevenlabs-js';

/** Model ID for the ElevenLabs realtime STT WebSocket. */
const ELEVENLABS_WS_STT_MODEL = 'scribe_v2_realtime';

/** Maximum consecutive reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 3;

/** Delay between reconnect attempts (ms). */
const RECONNECT_DELAY_MS = 1000;

/**
 * Callback signature for receiving a final (committed) transcript from the
 * ElevenLabs WebSocket STT stream.
 */
export type OnTranscriptCallback = (text: string) => void;

/**
 * Callback signature for receiving speech start/stop events from VAD.
 */
export type OnSpeechActivityCallback = () => void;

interface ElevenLabsSTTWSOptions {
  /** Called with final committed transcripts. */
  onTranscript: OnTranscriptCallback;
  /** Called when VAD detects speech has started (for barge-in). */
  onSpeechStart?: OnSpeechActivityCallback;
  /** Identifier used in log messages. */
  callSid: string;
}

/**
 * Create a per-session ElevenLabs realtime STT stream using the official SDK.
 *
 * Uses `@elevenlabs/elevenlabs-js` `ScribeRealtime` under the hood, which
 * handles auth (xi-api-key header), WebSocket management, and message parsing.
 *
 * Audio chunks (base64-encoded mulaw 8 kHz from Twilio) are forwarded to the
 * ElevenLabs real-time STT endpoint which handles VAD and returns transcript
 * events.
 *
 * @returns An `ElevenLabsSTTStream` handle with `sendAudio()` and `close()`.
 */
export function createElevenLabsSTTStream(
  opts: ElevenLabsSTTWSOptions,
): ElevenLabsSTTStream {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required for WebSocket STT');

  const { onTranscript, onSpeechStart, callSid } = opts;

  let connection: RealtimeConnection | null = null;
  let closed = false;
  let reconnectAttempts = 0;
  let pendingChunks: string[] = [];
  let connected = false;

  const client = new ElevenLabsClient({ apiKey });

  async function connect(): Promise<void> {
    if (closed) return;

    console.log(
      `[BELLA:STT:11LABS:WS] Opening SDK connection — callSid=${callSid} ` +
        `model=${ELEVENLABS_WS_STT_MODEL} attempt=${reconnectAttempts + 1} ` +
        `vadThreshold=0.7 minSpeech=200ms minSilence=300ms (noise-robust VAD)`,
    );

    try {
      const conn = await client.speechToText.realtime.connect({
        modelId: ELEVENLABS_WS_STT_MODEL,
        audioFormat: AudioFormat.ULAW_8000,
        sampleRate: 8000,
        commitStrategy: CommitStrategy.VAD,
        languageCode: 'en',
        // VAD tuning for noise robustness on phone audio
        vadThreshold: 0.7,
        minSpeechDurationMs: 200,
        minSilenceDurationMs: 300,
      });

      connection = conn;

      conn.on(RealtimeEvents.OPEN, () => {
        reconnectAttempts = 0;
        connected = true;
        console.log(`[BELLA:STT:11LABS:WS] Connected — callSid=${callSid}`);
        wsLogger.info({ callSid }, 'WebSocket connected');

        for (const chunk of pendingChunks) {
          trySendChunk(chunk);
        }
        pendingChunks = [];
      });

      conn.on(RealtimeEvents.SESSION_STARTED, (data) => {
        console.log(
          `[BELLA:STT:11LABS:WS] Session started — callSid=${callSid} sessionId=${data.session_id}`,
        );
      });

      conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
        const partial = (data.text ?? '').trim();
        if (partial) {
          console.log(
            `[BELLA:STT:11LABS:WS] Partial: "${partial}" — callSid=${callSid}`,
          );
          onSpeechStart?.();
        }
      });

      conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        const text = (data.text ?? '').trim();
        console.log(
          `[BELLA:STT:11LABS:WS] Committed: "${text}" — callSid=${callSid}`,
        );
        wsLogger.info({ callSid, text }, 'Committed transcript');
        if (text) {
          onTranscript(text);
        }
      });

      conn.on(RealtimeEvents.ERROR, (err) => {
        if (err instanceof Error) {
          console.error(
            `[BELLA:STT:11LABS:WS] WebSocket error — callSid=${callSid}`,
            err.message,
          );
        } else {
          console.error(
            `[BELLA:STT:11LABS:WS] Error event: ${err.message_type} — callSid=${callSid}`,
            err,
          );
        }
        wsLogger.error({ callSid, err }, 'STT WS error');
      });

      conn.on(RealtimeEvents.CLOSE, () => {
        console.log(
          `[BELLA:STT:11LABS:WS] WebSocket closed — callSid=${callSid}`,
        );
        wsLogger.info({ callSid }, 'WebSocket closed');
        connection = null;
        connected = false;

        if (!closed && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(
            `[BELLA:STT:11LABS:WS] Scheduling reconnect #${reconnectAttempts} ` +
              `in ${RECONNECT_DELAY_MS}ms — callSid=${callSid}`,
          );
          setTimeout(() => { connect().catch(() => {}); }, RECONNECT_DELAY_MS);
        }
      });
    } catch (err) {
      console.error(
        `[BELLA:STT:11LABS:WS] Connection failed — callSid=${callSid}`,
        err,
      );
      wsLogger.error({ callSid, err }, 'SDK connect failed');

      if (!closed && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        setTimeout(() => { connect().catch(() => {}); }, RECONNECT_DELAY_MS);
      }
    }
  }

  function trySendChunk(mulawBase64: string): void {
    if (!connection || !connected) return;
    try {
      connection.send({ audioBase64: mulawBase64 });
    } catch {
      // connection may have closed between the check and the send
    }
  }

  // --- Public interface ---

  function sendAudio(mulawBase64: string): void {
    if (closed) return;

    if (connection && connected) {
      trySendChunk(mulawBase64);
    } else {
      if (pendingChunks.length < 200) {
        pendingChunks.push(mulawBase64);
      }
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    pendingChunks = [];
    console.log(`[BELLA:STT:11LABS:WS] Closing — callSid=${callSid}`);

    if (connection) {
      try {
        connection.close();
      } catch {
        // connection may already be closing
      }
      connection = null;
    }
  }

  connect().catch(() => {});

  return { sendAudio, close };
}
