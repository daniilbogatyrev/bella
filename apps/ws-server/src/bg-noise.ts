import { readFileSync } from 'fs';
import path from 'path';
import { WaveFile } from 'wavefile';

const BG_NOISE_PATH = path.join(import.meta.dirname, 'bg-noise', 'call-center.wav');

let bgSamples: Float64Array | null = null;

function loadBgNoise(): Float64Array {
  if (bgSamples) return bgSamples;
  const buf = readFileSync(BG_NOISE_PATH);
  const wav = new WaveFile(buf);
  bgSamples = wav.getSamples() as Float64Array;
  console.log(
    `[BELLA:BGNOISE] Loaded background noise — ${bgSamples.length} samples (~${(bgSamples.length / 8000).toFixed(1)}s)`,
  );
  return bgSamples;
}

const MULAW_BIAS = 0x84;

function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let mag = Math.min(Math.abs(sample), 32635);
  mag += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (mag & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    /* find segment */
  }
  const mantissa = (mag >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function mulawToLinear(mulaw: number): number {
  const mu = ~mulaw & 0xFF;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0F;
  let magnitude = ((mantissa << 1) | 0x21) << (exponent + 2);
  magnitude -= MULAW_BIAS;
  return sign ? -magnitude : magnitude;
}

const DEFAULT_BG_GAIN = 0.04;

/**
 * Mix base64-encoded mulaw TTS audio with looping call-center background noise.
 *
 * The mixing is done at the PCM level: mulaw → PCM16 → linear mix → PCM16 → mulaw.
 * The background audio loops seamlessly using a seek position that persists across
 * chunks within a session.
 *
 * @param mulawBase64 - TTS audio chunk in mulaw 8kHz base64 (from Gradium TTS)
 * @param bgSeekPosition - Current position in the background noise loop (per session)
 * @param bgGain - Background volume relative to voice (0.0–1.0, default 0.04)
 * @returns Object with `mixed` (base64 mulaw) and `newSeekPosition`
 */
export function mixWithBackground(
  mulawBase64: string,
  bgSeekPosition: number,
  bgGain: number = DEFAULT_BG_GAIN,
): { mixed: string; newSeekPosition: number } {
  const mulawBuf = Buffer.from(mulawBase64, 'base64');
  const result = mixChunkWithBackground(mulawBuf, bgSeekPosition, bgGain);
  return { mixed: result.mixed.toString('base64'), newSeekPosition: result.newSeekPosition };
}

/**
 * Mix a raw mulaw audio buffer with looping call-center background noise.
 *
 * Operates on raw Buffers (not base64) for use in the continuous audio loop.
 * Each byte in the input is one mulaw sample (8kHz mono).
 *
 * @param mulawChunk - Raw mulaw audio buffer (160 bytes = 20ms at 8kHz)
 * @param bgSeekPosition - Current position in the background noise loop
 * @param bgGain - Background volume (0.0–1.0, default 0.04)
 * @returns Object with `mixed` (raw mulaw Buffer) and `newSeekPosition`
 */
export function mixChunkWithBackground(
  mulawChunk: Buffer,
  bgSeekPosition: number,
  bgGain: number = DEFAULT_BG_GAIN,
): { mixed: Buffer; newSeekPosition: number } {
  const bg = loadBgNoise();
  const out = Buffer.allocUnsafe(mulawChunk.length);
  const voiceGain = 1 - bgGain;
  let seekPos = bgSeekPosition;

  for (let i = 0; i < mulawChunk.length; i++) {
    const voicePcm = mulawToLinear(mulawChunk[i]!);
    seekPos = (seekPos + 1) % bg.length;
    const mixedSample = (voicePcm * voiceGain) + (bg[seekPos]! * bgGain);
    out[i] = linearToMulaw(Math.max(-32768, Math.min(32767, Math.round(mixedSample))));
  }

  return { mixed: out, newSeekPosition: seekPos };
}

/**
 * Generate a background-noise-only chunk in mulaw format.
 *
 * Used by the continuous audio loop to fill silence between TTS responses
 * so the caller always hears ambient call-center noise.
 *
 * @param chunkSize - Number of mulaw bytes to generate (160 = 20ms at 8kHz)
 * @param bgSeekPosition - Current position in the background noise loop
 * @param bgGain - Background volume (0.0–1.0, default 0.04)
 * @returns Object with `chunk` (base64 mulaw) and `newSeekPosition`
 */
export function getBackgroundOnlyChunk(
  chunkSize: number,
  bgSeekPosition: number,
  bgGain: number = DEFAULT_BG_GAIN,
): { chunk: string; newSeekPosition: number } {
  const bg = loadBgNoise();
  const out = Buffer.allocUnsafe(chunkSize);
  let seekPos = bgSeekPosition;

  for (let i = 0; i < chunkSize; i++) {
    seekPos = (seekPos + 1) % bg.length;
    const pcmSample = Math.max(-32768, Math.min(32767, Math.round(bg[seekPos]! * bgGain)));
    out[i] = linearToMulaw(pcmSample);
  }

  return { chunk: out.toString('base64'), newSeekPosition: seekPos };
}
