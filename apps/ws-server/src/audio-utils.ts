/**
 * Shared audio format conversion utilities for mu-law / PCM encoding
 * used by the Twilio ↔ ElevenLabs audio pipeline.
 *
 * @module audio-utils
 */

const MULAW_MAX = 0x1fff;
const MULAW_BIAS = 0x84;

/**
 * Encode a single 16-bit linear PCM sample to 8-bit mu-law (ITU-T G.711).
 *
 * @param sample - Signed 16-bit PCM sample (-32768 … 32767)
 * @returns 8-bit mu-law encoded byte (0 … 255)
 */
export function linearToMulaw(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }

  if (sample > MULAW_MAX) sample = MULAW_MAX;
  sample += MULAW_BIAS;

  let exponent = 0;
  let mantissa: number;

  const expLut = [0, 132, 396, 924, 1980, 4092, 8316, 16764];
  for (exponent = 7; exponent > 0; exponent--) {
    if (sample >= (expLut[exponent] ?? 0)) break;
  }

  mantissa = (sample >> (exponent + 3)) & 0x0f;

  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulawByte;
}

/**
 * Decode a single 8-bit mu-law byte to a 16-bit linear PCM sample.
 * Standard ITU-T G.711 mu-law expansion.
 *
 * @param mulawByte - 8-bit mu-law encoded byte (0 … 255)
 * @returns Signed 16-bit PCM sample
 */
export function mulawToLinear(mulawByte: number): number {
  mulawByte = ~mulawByte & 0xFF;

  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0F;

  const magnitude = ((2 * mantissa + 33) << exponent) - 33;

  return sign !== 0 ? -magnitude : magnitude;
}

/**
 * Convert a base64-encoded PCM 16-bit signed LE 16 kHz buffer
 * to base64-encoded mu-law 8 kHz suitable for Twilio.
 *
 * Downsamples by 2× (takes every other sample) and encodes to mu-law.
 *
 * @param pcmBase64 - Base64-encoded PCM 16-bit 16 kHz audio
 * @returns Base64-encoded mu-law 8 kHz audio
 */
export function pcm16kToMulaw8k(pcmBase64: string): string {
  const pcmBuffer = Buffer.from(pcmBase64, "base64");
  const pcmSamples = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.byteLength / 2,
  );

  const downsampledLength = Math.floor(pcmSamples.length / 2);
  const mulawBuffer = Buffer.alloc(downsampledLength);

  for (let i = 0; i < downsampledLength; i++) {
    const sample = pcmSamples[i * 2] ?? 0;
    mulawBuffer[i] = linearToMulaw(sample);
  }

  return mulawBuffer.toString("base64");
}

/**
 * Convert a base64-encoded mu-law 8 kHz buffer to base64-encoded
 * PCM 16-bit signed LE 16 kHz suitable for ElevenLabs input.
 *
 * Each mu-law byte decodes to one 16-bit PCM sample at 8 kHz.
 * Samples are duplicated to upsample from 8 kHz → 16 kHz.
 *
 * @param mulawBase64 - Base64-encoded mu-law 8 kHz audio
 * @returns Base64-encoded PCM 16-bit 16 kHz audio
 */
export function mulaw8kToPcm16k(mulawBase64: string): string {
  const mulawBuffer = Buffer.from(mulawBase64, "base64");

  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 4);

  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = mulawToLinear(mulawBuffer[i]!);
    pcmBuffer.writeInt16LE(sample, i * 4);
    pcmBuffer.writeInt16LE(sample, i * 4 + 2);
  }

  return pcmBuffer.toString("base64");
}
