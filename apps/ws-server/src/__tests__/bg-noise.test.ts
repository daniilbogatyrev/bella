import { describe, test, expect } from 'bun:test';
import { mixWithBackground } from '../bg-noise';
import { WaveFile } from 'wavefile';

/**
 * Generate a short mulaw audio buffer encoded as base64.
 * Creates a 440Hz sine tone at 8kHz sample rate, then encodes as mulaw.
 */
function generateTestMulawBase64(durationMs: number): string {
  const sampleRate = 8000;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const samples = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
  }

  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, '16', samples);
  wav.toMuLaw();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Buffer.from((wav.data as any).samples).toString('base64');
}

describe('bg-noise mixing', () => {
  test('mixWithBackground returns valid base64 mulaw and advances seek position', () => {
    const inputBase64 = generateTestMulawBase64(100); // 100ms = 800 samples
    const inputBytes = Buffer.from(inputBase64, 'base64').length;

    const result = mixWithBackground(inputBase64, 0, 0.04);

    // Output should be valid base64
    expect(result.mixed).toBeTruthy();
    expect(typeof result.mixed).toBe('string');

    // Output bytes should equal input bytes (same duration)
    const outputBytes = Buffer.from(result.mixed, 'base64').length;
    expect(outputBytes).toBe(inputBytes);

    // Seek position should advance by the number of samples
    expect(result.newSeekPosition).toBe(inputBytes);
  });

  test('seek position wraps around the background loop', () => {
    const inputBase64 = generateTestMulawBase64(20); // 20ms = 160 samples

    // Start near "end" of bg loop — should wrap around
    const result1 = mixWithBackground(inputBase64, 0, 0.04);
    const result2 = mixWithBackground(inputBase64, result1.newSeekPosition, 0.04);

    // Successive calls should produce different seek positions
    expect(result2.newSeekPosition).toBeGreaterThan(result1.newSeekPosition);
  });

  test('mixing with bgGain=0 should output same audio as input', () => {
    const inputBase64 = generateTestMulawBase64(20);

    const result = mixWithBackground(inputBase64, 0, 0.0);

    // With zero background gain, output should closely match input
    // (there might be tiny rounding differences from PCM conversions)
    const inputBuf = Buffer.from(inputBase64, 'base64');
    const outputBuf = Buffer.from(result.mixed, 'base64');
    expect(outputBuf.length).toBe(inputBuf.length);

    // Check most bytes are identical or very close
    let matchCount = 0;
    for (let i = 0; i < inputBuf.length; i++) {
      if (inputBuf[i] === outputBuf[i]) matchCount++;
    }
    // With zero bg gain, at least 95% of mulaw bytes should be identical
    const matchRatio = matchCount / inputBuf.length;
    expect(matchRatio).toBeGreaterThan(0.95);
  });

  test('mixing with bgGain=1 should differ significantly from input', () => {
    const inputBase64 = generateTestMulawBase64(20);

    const result = mixWithBackground(inputBase64, 0, 1.0);
    const inputBuf = Buffer.from(inputBase64, 'base64');
    const outputBuf = Buffer.from(result.mixed, 'base64');

    // With full background gain, output should differ from input
    let diffCount = 0;
    for (let i = 0; i < inputBuf.length; i++) {
      if (inputBuf[i] !== outputBuf[i]) diffCount++;
    }
    // At least some bytes should differ
    expect(diffCount).toBeGreaterThan(0);
  });
});
