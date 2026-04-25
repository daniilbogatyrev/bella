import { elevenLabsSpeechToText, createElevenLabsSTTStream } from './elevenlabs';
import type { ElevenLabsSTTStream } from './types';
import type { OnTranscriptCallback, OnSpeechActivityCallback } from './elevenlabs';

const STT_PROVIDER = process.env.STT_PROVIDER || 'gradium';

/** RMS energy threshold below which mulaw audio is considered silence/ambient noise.
 *  Mulaw byte 0xFF represents zero amplitude (silence). We measure deviation from that. */
const SILENCE_RMS_THRESHOLD = 5;

/**
 * Detect whether base64-encoded mulaw audio is effectively silence or ambient noise.
 *
 * Mulaw encoding uses 0xFF (255) as the zero-amplitude "silence" value.
 * We compute the RMS deviation from 0xFF — low RMS means no real speech energy.
 *
 * @param mulawBase64 - Base64-encoded mulaw 8 kHz audio
 * @returns true if the audio energy is below the silence threshold
 */
export function isLikelySilence(mulawBase64: string): boolean {
  const buf = Buffer.from(mulawBase64, 'base64');
  if (buf.length === 0) return true;

  let energy = 0;
  for (let i = 0; i < buf.length; i++) {
    const deviation = Math.abs(buf[i]! - 0xff);
    energy += deviation * deviation;
  }
  const rms = Math.sqrt(energy / buf.length);
  return rms < SILENCE_RMS_THRESHOLD;
}

/**
 * Transcribe base64-encoded mulaw 8 kHz audio to text using the configured STT
 * provider in **buffered** (non-streaming) mode.
 *
 * This is used for providers that don't support WebSocket streaming (e.g. Gradium)
 * and as a REST fallback for ElevenLabs.
 *
 * Provider is selected via the `STT_PROVIDER` environment variable:
 * - `'gradium'` (default) — Gradium WebSocket STT with PCM 24 kHz upsampling
 * - `'elevenlabs'` — ElevenLabs REST STT API with WAV conversion
 *
 * Silence detection runs first — if the audio energy is below the threshold,
 * STT is skipped entirely (saves API calls and prevents "(static sound)" artifacts).
 *
 * The gradium import is deferred via dynamic `import()` so that the ai-coustics
 * native binary (pulled in by gradium → aicoustics) is never loaded when the
 * ElevenLabs provider is active.
 *
 * @param base64Audio - Base64-encoded mulaw 8 kHz audio from Twilio
 * @returns Transcribed text string (empty string for silence)
 */
export async function speechToText(base64Audio: string): Promise<string> {
  if (isLikelySilence(base64Audio)) {
    console.log('[BELLA:STT] Skipping STT — audio is silence/noise');
    return '';
  }

  if (STT_PROVIDER === 'elevenlabs') {
    return elevenLabsSpeechToText(base64Audio);
  }
  const { getGradiumClient } = await import('./gradium');
  const gradium = getGradiumClient();
  return gradium.speechToText(base64Audio);
}

/** Return the name of the currently configured STT provider. */
export function getSTTProviderName(): string {
  return STT_PROVIDER;
}

/**
 * Whether the active STT provider supports per-chunk WebSocket streaming.
 *
 * When true, `session.ts` should pipe audio directly to the stream instead of
 * buffering and flushing via `speechToText()`.
 */
export function isStreamingSTTEnabled(): boolean {
  return STT_PROVIDER === 'elevenlabs';
}

/**
 * Create a per-session streaming STT handle.
 *
 * Only valid when `isStreamingSTTEnabled()` returns true.
 *
 * @param onTranscript - Called when a final committed transcript arrives
 * @param onSpeechStart - Called on first partial transcript (VAD speech-start)
 * @param callSid - Twilio call SID for log correlation
 * @returns An `ElevenLabsSTTStream` handle
 * @throws if the active provider does not support streaming
 */
export function createStreamingSTT(
  onTranscript: OnTranscriptCallback,
  onSpeechStart: OnSpeechActivityCallback | undefined,
  callSid: string,
): ElevenLabsSTTStream {
  if (STT_PROVIDER !== 'elevenlabs') {
    throw new Error(
      `Streaming STT not supported for provider "${STT_PROVIDER}". ` +
        `Use speechToText() for buffered transcription.`,
    );
  }
  return createElevenLabsSTTStream({ onTranscript, onSpeechStart, callSid });
}
