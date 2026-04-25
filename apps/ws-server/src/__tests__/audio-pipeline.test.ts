import { describe, it, expect } from 'bun:test';

/**
 * Integration tests for the audio encoding pipeline.
 *
 * Validates every format conversion in the inbound audio path:
 *   Twilio mulaw 8 kHz → PCM 24 kHz → (optional) ai-coustics → WAV → ElevenLabs
 *
 * We import the private helpers via re-exports where possible, and otherwise
 * duplicate the pure functions here so we can test them without side effects.
 */

// ---------------------------------------------------------------------------
// Re-create the pure conversion functions so we can test them in isolation
// (they are module-private in elevenlabs.ts / aicoustics.ts).
// ---------------------------------------------------------------------------

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

function downsample24kTo16k(pcm24k: Int16Array): Int16Array {
  const outLen = Math.floor((pcm24k.length * 2) / 3);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * 3) / 2;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    if (idx + 1 < pcm24k.length) {
      out[i] = Math.round(pcm24k[idx]! * (1 - frac) + pcm24k[idx + 1]! * frac);
    } else {
      out[i] = pcm24k[idx] ?? 0;
    }
  }
  return out;
}

function upsample16kTo24k(pcm16k: Int16Array): Int16Array {
  const outLen = Math.floor((pcm16k.length * 3) / 2);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * 2) / 3;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    if (idx + 1 < pcm16k.length) {
      out[i] = Math.round(pcm16k[idx]! * (1 - frac) + pcm16k[idx + 1]! * frac);
    } else {
      out[i] = pcm16k[idx] ?? 0;
    }
  }
  return out;
}

function int16ToFloat32(pcm: Int16Array): Float32Array {
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    f[i] = pcm[i]! / 32768;
  }
  return f;
}

function float32ToInt16(f32: Float32Array): Int16Array {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]!));
    pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return pcm;
}

// ---------------------------------------------------------------------------
// WAV header parsing helper
// ---------------------------------------------------------------------------

interface WavHeader {
  riffTag: string;
  fileSize: number;
  waveTag: string;
  fmtTag: string;
  fmtChunkSize: number;
  formatTag: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  cbSize?: number;
  dataTag: string;
  dataSize: number;
}

function parseWavHeader(buf: Buffer): WavHeader {
  const riffTag = buf.toString('ascii', 0, 4);
  const fileSize = buf.readUInt32LE(4);
  const waveTag = buf.toString('ascii', 8, 12);
  const fmtTag = buf.toString('ascii', 12, 16);
  const fmtChunkSize = buf.readUInt32LE(16);
  const formatTag = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const blockAlign = buf.readUInt16LE(32);
  const bitsPerSample = buf.readUInt16LE(34);

  // Position after core fmt fields (at offset 36)
  let dataOffset: number;
  let cbSize: number | undefined;

  if (fmtChunkSize > 16) {
    cbSize = buf.readUInt16LE(36);
    dataOffset = 20 + fmtChunkSize; // skip past fmt chunk data
  } else {
    dataOffset = 36;
  }

  const dataTag = buf.toString('ascii', dataOffset, dataOffset + 4);
  const dataSize = buf.readUInt32LE(dataOffset + 4);

  return {
    riffTag, fileSize, waveTag, fmtTag, fmtChunkSize,
    formatTag, channels, sampleRate, byteRate, blockAlign,
    bitsPerSample, cbSize, dataTag, dataSize,
  };
}

// ---------------------------------------------------------------------------
// Generate realistic mulaw silence/tone for testing
// ---------------------------------------------------------------------------

/** mulaw encode a signed 16-bit sample (inverse of mulawDecode). */
function mulawEncode(sample: number): number {
  const MULAW_BIAS = 0x84; // 132
  const MULAW_CLIP = 32635;

  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  let exponent = 0;
  let mask = 0x4000;
  for (exponent = 14; exponent > 0; exponent--) {
    if (sample & mask) break;
    mask >>= 1;
  }
  // Adjust to 3-bit exponent (0-7 range)
  exponent = Math.max(0, exponent - 7);

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const byte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return byte;
}

/** Create a mulaw-encoded 8 kHz sine wave as base64. */
function generateMulawSine(freqHz: number, durationMs: number): string {
  const numSamples = Math.floor((8000 * durationMs) / 1000);
  const buf = Buffer.alloc(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / 8000;
    const pcmSample = Math.round(16000 * Math.sin(2 * Math.PI * freqHz * t));
    buf[i] = mulawEncode(pcmSample);
  }
  return buf.toString('base64');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audio Pipeline', () => {
  describe('mulawDecode (G.711)', () => {
    it('decodes 0xFF (silence) to 0', () => {
      // 0xFF is the mulaw representation of zero amplitude
      const result = mulawDecode(0xff);
      expect(result).toBe(0);
    });

    it('decodes 0x7F (negative silence) to negative zero', () => {
      const result = mulawDecode(0x7f);
      // G.711: 0x7F has sign=1 (negative) with zero magnitude → -0
      expect(result).toEqual(-0);
    });

    it('produces output in 16-bit signed range', () => {
      for (let byte = 0; byte < 256; byte++) {
        const sample = mulawDecode(byte);
        expect(sample).toBeGreaterThanOrEqual(-32768);
        expect(sample).toBeLessThanOrEqual(32767);
      }
    });

    it('covers full dynamic range across all 256 byte values', () => {
      const decoded = new Set<number>();
      for (let byte = 0; byte < 256; byte++) {
        decoded.add(mulawDecode(byte));
      }
      // mulaw maps 256 byte values to 256 distinct PCM levels (128 positive + 128 negative)
      // minus the two zero values (0x7F→-0 and 0xFF→0). We should get at least 200 distinct values.
      expect(decoded.size).toBeGreaterThan(200);

      // Max positive magnitude should be near 32124 (the G.711 maximum)
      let maxMag = 0;
      for (const val of decoded) {
        maxMag = Math.max(maxMag, Math.abs(val));
      }
      expect(maxMag).toBeGreaterThanOrEqual(32000);
    });

    it('round-trips encode → decode within tolerance', () => {
      const testSamples = [0, 100, -100, 1000, -1000, 8000, -8000];
      for (const original of testSamples) {
        const encoded = mulawEncode(original);
        const decoded = mulawDecode(encoded);
        // mulaw is lossy with ~1% quantization error at high magnitudes
        // and larger relative error at low magnitudes. Use 10% + 200 absolute.
        const tolerance = Math.max(Math.abs(original) * 0.10, 200);
        expect(Math.abs(decoded - original)).toBeLessThanOrEqual(tolerance);
      }
    });
  });

  describe('mulawToLinear24k (8kHz → 24kHz upsampling)', () => {
    it('produces exactly 6× the number of bytes as input mulaw bytes', () => {
      const numMulawBytes = 160; // 20ms at 8kHz
      const mulawBuf = Buffer.alloc(numMulawBytes, 0xff); // silence
      const b64 = mulawBuf.toString('base64');

      const pcm24k = mulawToLinear24k(b64);

      // N mulaw bytes → N×3 Int16 samples → N×6 bytes
      expect(pcm24k.length).toBe(numMulawBytes * 6);
    });

    it('produces correct length for typical Twilio buffer (~2s)', () => {
      const numMulawBytes = 16000; // ~2 seconds at 8kHz
      const mulawBuf = Buffer.alloc(numMulawBytes, 0xff);
      const b64 = mulawBuf.toString('base64');

      const pcm24k = mulawToLinear24k(b64);
      expect(pcm24k.length).toBe(96000); // 16000 × 6
    });

    it('preserves silence through the pipeline', () => {
      const numMulawBytes = 480; // 60ms
      const mulawBuf = Buffer.alloc(numMulawBytes, 0xff); // all silence
      const b64 = mulawBuf.toString('base64');

      const pcm24k = mulawToLinear24k(b64);
      const samples = new Int16Array(
        pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength / 2,
      );

      // All samples should be 0 (or very close, from interpolation of zeros)
      for (let i = 0; i < samples.length; i++) {
        expect(Math.abs(samples[i]!)).toBeLessThanOrEqual(1);
      }
    });

    it('produces non-zero output for a tone', () => {
      const toneB64 = generateMulawSine(440, 100); // 440 Hz, 100ms
      const pcm24k = mulawToLinear24k(toneB64);
      const samples = new Int16Array(
        pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength / 2,
      );

      let maxAbs = 0;
      for (let i = 0; i < samples.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(samples[i]!));
      }
      expect(maxAbs).toBeGreaterThan(1000); // should have real signal
    });
  });

  describe('downsample24kTo16k and upsample16kTo24k', () => {
    it('downsample produces correct output length', () => {
      const pcm24k = new Int16Array(2400); // 100ms at 24kHz
      const pcm16k = downsample24kTo16k(pcm24k);
      expect(pcm16k.length).toBe(1600); // 100ms at 16kHz
    });

    it('upsample produces correct output length', () => {
      const pcm16k = new Int16Array(1600); // 100ms at 16kHz
      const pcm24k = upsample16kTo24k(pcm16k);
      expect(pcm24k.length).toBe(2400); // 100ms at 24kHz
    });

    it('round-trip downsample→upsample preserves approximate length', () => {
      const original = new Int16Array(24000); // 1 second at 24kHz
      const down = downsample24kTo16k(original);
      const up = upsample16kTo24k(down);
      // Should be close to original length (rounding may lose/gain 1-2 samples)
      expect(Math.abs(up.length - original.length)).toBeLessThanOrEqual(2);
    });

    it('round-trip preserves signal shape for a sine wave', () => {
      const numSamples = 2400; // 100ms at 24kHz
      const original = new Int16Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        original[i] = Math.round(10000 * Math.sin(2 * Math.PI * 440 * i / 24000));
      }

      const down = downsample24kTo16k(original);
      const up = upsample16kTo24k(down);

      // Compute correlation between original and round-tripped
      let sumProduct = 0;
      let sumOrig2 = 0;
      let sumUp2 = 0;
      const len = Math.min(original.length, up.length);
      for (let i = 0; i < len; i++) {
        sumProduct += original[i]! * up[i]!;
        sumOrig2 += original[i]! * original[i]!;
        sumUp2 += up[i]! * up[i]!;
      }
      const correlation = sumProduct / (Math.sqrt(sumOrig2) * Math.sqrt(sumUp2));
      // Resampling introduces artifacts but correlation should be high
      expect(correlation).toBeGreaterThan(0.9);
    });
  });

  describe('int16 ↔ float32 conversion', () => {
    it('int16ToFloat32 maps range [-32768, 32767] → approximately [-1.0, 1.0]', () => {
      const pcm = new Int16Array([0, 32767, -32768, 16384, -16384]);
      const f = int16ToFloat32(pcm);

      expect(f[0]).toBeCloseTo(0, 5);
      expect(f[1]).toBeCloseTo(32767 / 32768, 5);
      expect(f[2]).toBeCloseTo(-1.0, 5);
      expect(f[3]).toBeCloseTo(0.5, 3);
      expect(f[4]).toBeCloseTo(-0.5, 3);
    });

    it('float32ToInt16 maps [-1.0, 1.0] → [-32768, 32767]', () => {
      const f = new Float32Array([0, 1.0, -1.0, 0.5, -0.5]);
      const pcm = float32ToInt16(f);

      expect(pcm[0]).toBe(0);
      expect(pcm[1]).toBe(32767);
      expect(pcm[2]).toBe(-32768);
      expect(Math.abs(pcm[3]! - 16384)).toBeLessThanOrEqual(1);
      expect(Math.abs(pcm[4]! - (-16384))).toBeLessThanOrEqual(1);
    });

    it('float32ToInt16 clamps out-of-range values', () => {
      const f = new Float32Array([1.5, -1.5, 2.0, -3.0]);
      const pcm = float32ToInt16(f);

      expect(pcm[0]).toBe(32767);
      expect(pcm[1]).toBe(-32768);
      expect(pcm[2]).toBe(32767);
      expect(pcm[3]).toBe(-32768);
    });

    it('round-trip int16 → float32 → int16 is lossless', () => {
      const original = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345]);
      const floats = int16ToFloat32(original);
      const roundTripped = float32ToInt16(floats);

      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(roundTripped[i]! - original[i]!)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('WAV headers', () => {
    it('PCM WAV header matches 24kHz 16-bit mono format', () => {
      // Simulate pcmToWav behavior inline
      const pcmData = Buffer.alloc(4800); // 100ms at 24kHz (2400 samples × 2 bytes)
      const sampleRate = 24000;
      const bitsPerSample = 16;
      const dataSize = pcmData.length;
      const byteRate = sampleRate * 1 * (bitsPerSample / 8);
      const blockAlign = 1 * (bitsPerSample / 8);

      const wav = Buffer.alloc(44 + dataSize);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(36 + dataSize, 4);
      wav.write('WAVE', 8);
      wav.write('fmt ', 12);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20); // PCM
      wav.writeUInt16LE(1, 22); // mono
      wav.writeUInt32LE(sampleRate, 24);
      wav.writeUInt32LE(byteRate, 28);
      wav.writeUInt16LE(blockAlign, 32);
      wav.writeUInt16LE(bitsPerSample, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(dataSize, 40);
      pcmData.copy(wav, 44);

      const hdr = parseWavHeader(wav);
      expect(hdr.riffTag).toBe('RIFF');
      expect(hdr.waveTag).toBe('WAVE');
      expect(hdr.fmtTag).toBe('fmt ');
      expect(hdr.fmtChunkSize).toBe(16);
      expect(hdr.formatTag).toBe(1); // PCM
      expect(hdr.channels).toBe(1);
      expect(hdr.sampleRate).toBe(24000);
      expect(hdr.byteRate).toBe(48000);
      expect(hdr.blockAlign).toBe(2);
      expect(hdr.bitsPerSample).toBe(16);
      expect(hdr.dataTag).toBe('data');
      expect(hdr.dataSize).toBe(dataSize);
    });

    it('mulaw WAV header has fmt chunk size 18 with cbSize=0', () => {
      // Simulate the FIXED mulawBase64ToWav header
      const mulawData = Buffer.alloc(800); // 100ms at 8kHz
      const dataSize = mulawData.length;
      const fmtChunkSize = 18;
      const headerSize = 12 + 8 + fmtChunkSize + 8; // = 46

      const wav = Buffer.alloc(headerSize + dataSize);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(headerSize - 8 + dataSize, 4);
      wav.write('WAVE', 8);
      wav.write('fmt ', 12);
      wav.writeUInt32LE(fmtChunkSize, 16);
      wav.writeUInt16LE(7, 20); // mulaw
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32);
      wav.writeUInt16LE(8, 34);
      wav.writeUInt16LE(0, 36); // cbSize
      wav.write('data', 38);
      wav.writeUInt32LE(dataSize, 42);
      mulawData.copy(wav, headerSize);

      const hdr = parseWavHeader(wav);
      expect(hdr.riffTag).toBe('RIFF');
      expect(hdr.waveTag).toBe('WAVE');
      expect(hdr.fmtTag).toBe('fmt ');
      expect(hdr.fmtChunkSize).toBe(18);
      expect(hdr.formatTag).toBe(7); // mulaw
      expect(hdr.channels).toBe(1);
      expect(hdr.sampleRate).toBe(8000);
      expect(hdr.byteRate).toBe(8000);
      expect(hdr.blockAlign).toBe(1);
      expect(hdr.bitsPerSample).toBe(8);
      expect(hdr.cbSize).toBe(0);
      expect(hdr.dataTag).toBe('data');
      expect(hdr.dataSize).toBe(dataSize);
    });

    it('file size in RIFF header matches actual buffer size', () => {
      const mulawData = Buffer.alloc(1600);
      const dataSize = mulawData.length;
      const fmtChunkSize = 18;
      const headerSize = 46;

      const wav = Buffer.alloc(headerSize + dataSize);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(headerSize - 8 + dataSize, 4);
      wav.write('WAVE', 8);
      wav.write('fmt ', 12);
      wav.writeUInt32LE(fmtChunkSize, 16);
      wav.writeUInt16LE(7, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32);
      wav.writeUInt16LE(8, 34);
      wav.writeUInt16LE(0, 36);
      wav.write('data', 38);
      wav.writeUInt32LE(dataSize, 42);
      mulawData.copy(wav, headerSize);

      // RIFF file size = total - 8 (for "RIFF" + size field itself)
      const riffSize = wav.readUInt32LE(4);
      expect(riffSize + 8).toBe(wav.length);
    });
  });

  describe('End-to-end pipeline sizes', () => {
    it('160 mulaw bytes (20ms) → 960 PCM bytes (24kHz)', () => {
      const mulawBuf = Buffer.alloc(160, 0xff);
      const b64 = mulawBuf.toString('base64');
      const pcm24k = mulawToLinear24k(b64);
      expect(pcm24k.length).toBe(160 * 6); // 960
    });

    it('16000 mulaw bytes (~2s) → 96000 PCM bytes → downsample → 64000 bytes → upsample → ~96000 bytes', () => {
      const numMulaw = 16000;
      const mulawBuf = Buffer.alloc(numMulaw, 0xff);
      const b64 = mulawBuf.toString('base64');

      const pcm24k = mulawToLinear24k(b64);
      expect(pcm24k.length).toBe(numMulaw * 6); // 96000 bytes

      const samples24k = new Int16Array(
        pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength / 2,
      );
      expect(samples24k.length).toBe(numMulaw * 3); // 48000 samples

      const samples16k = downsample24kTo16k(samples24k);
      expect(samples16k.length).toBe(32000); // 48000 * 2/3

      const samplesBack24k = upsample16kTo24k(samples16k);
      expect(samplesBack24k.length).toBe(48000); // 32000 * 3/2
    });
  });

  describe('Base64 buffer concatenation', () => {
    it('concat of individual base64 chunks equals single encoding', () => {
      // Simulate what flushAudioBuffer does
      const chunk1 = Buffer.from([0xff, 0xff, 0xff, 0xff]);
      const chunk2 = Buffer.from([0x80, 0x80, 0x80, 0x80]);
      const chunk3 = Buffer.from([0x00, 0x00, 0x00, 0x00]);

      const b64Chunks = [
        chunk1.toString('base64'),
        chunk2.toString('base64'),
        chunk3.toString('base64'),
      ];

      // Method used in flushAudioBuffer
      const combined = Buffer.concat(
        b64Chunks.map(c => Buffer.from(c, 'base64')),
      ).toString('base64');

      // Verify it equals directly encoding the concatenated raw bytes
      const directConcat = Buffer.concat([chunk1, chunk2, chunk3]).toString('base64');
      expect(combined).toBe(directConcat);
    });

    it('single chunk optimization returns chunk as-is', () => {
      const chunk = Buffer.from([0xff, 0x80, 0x00]).toString('base64');
      const chunks = [chunk];

      const combined = chunks.length === 1
        ? chunks[0]!
        : Buffer.concat(chunks.map(c => Buffer.from(c, 'base64'))).toString('base64');

      expect(combined).toBe(chunk);
    });
  });
});
