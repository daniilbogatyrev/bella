import { Model, Processor, ProcessorParameter } from '@ai-coustics/aic-sdk';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';

const SAMPLE_RATE = 16_000;
const NUM_CHANNELS = 1;
const MODEL_ID = 'quail-vf-2.1-l-16khz';
const MODEL_DIR = '/tmp/subhmx-ai-coustics/models';
const ENHANCEMENT_LEVEL = 0.8;

let processor: InstanceType<typeof Processor> | null = null;
let optimalNumFrames: number = 0;
let initPromise: Promise<void> | null = null;

/**
 * Lazily download the model, create the processor, and initialize it.
 * Safe to call multiple times — only the first invocation does real work.
 */
function ensureInitialized(): Promise<void> {
  if (processor) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const licenseKey = process.env.AI_COUSTIC;
    if (!licenseKey) throw new Error('AI_COUSTIC license key is not set');

    mkdirSync(MODEL_DIR, { recursive: true });

    let modelPath: string | undefined;
    if (existsSync(MODEL_DIR)) {
      const cached = readdirSync(MODEL_DIR).find(
        (f) => f.endsWith('.aicmodel') && f.startsWith(MODEL_ID),
      );
      if (cached) modelPath = path.join(MODEL_DIR, cached);
    }

    if (modelPath) {
      console.log(`[BELLA:ENHANCE] Model already cached at ${modelPath}, skipping download`);
    } else {
      console.log(`[BELLA:ENHANCE] Downloading model ${MODEL_ID} to ${MODEL_DIR}…`);
      modelPath = Model.download(MODEL_ID, MODEL_DIR);
      console.log(`[BELLA:ENHANCE] Model downloaded → ${modelPath}`);
    }

    const model = Model.fromFile(modelPath);
    optimalNumFrames = model.getOptimalNumFrames(SAMPLE_RATE);

    console.log(
      `[BELLA:ENHANCE] Creating processor — sampleRate=${SAMPLE_RATE} channels=${NUM_CHANNELS} ` +
        `optimalFrames=${optimalNumFrames} model=${model.getId()}`,
    );

    processor = new Processor(model, licenseKey);
    processor.initialize(SAMPLE_RATE, NUM_CHANNELS, optimalNumFrames, true);

    const ctx = processor.getProcessorContext();
    ctx.setParameter(ProcessorParameter.EnhancementLevel, ENHANCEMENT_LEVEL);

    const delay = ctx.getOutputDelay();
    console.log(
      `[BELLA:ENHANCE] Processor ready — enhancementLevel=${ENHANCEMENT_LEVEL} ` +
        `outputDelay=${delay} samples (${((delay / SAMPLE_RATE) * 1000).toFixed(1)} ms)`,
    );
  })();

  initPromise.catch(() => {
    initPromise = null;
  });

  return initPromise;
}

/**
 * Down-sample PCM 24 kHz → 16 kHz using simple 3:2 linear interpolation.
 * Input: Int16Array at 24 kHz. Output: Int16Array at 16 kHz.
 */
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

/**
 * Up-sample PCM 16 kHz → 24 kHz using 2:3 linear interpolation.
 * Input: Int16Array at 16 kHz. Output: Int16Array at 24 kHz.
 */
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

/** Convert signed 16-bit PCM samples to float32 in [-1, 1]. */
function int16ToFloat32(pcm: Int16Array): Float32Array {
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    f[i] = pcm[i]! / 32768;
  }
  return f;
}

/** Convert float32 [-1, 1] back to signed 16-bit PCM. */
function float32ToInt16(f32: Float32Array): Int16Array {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]!));
    pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return pcm;
}

/**
 * Enhance a PCM 24 kHz 16-bit mono audio buffer using ai-coustics Quail Voice Focus.
 *
 * Pipeline: 24 kHz→16 kHz → float32 → process in optimal-frame chunks → int16 → 16 kHz→24 kHz
 *
 * On failure the original buffer is returned so the STT pipeline is never broken.
 *
 * @param pcmBuffer - Buffer of PCM 24 kHz 16-bit LE mono audio (from mulawToLinear24k)
 * @returns Enhanced PCM 24 kHz 16-bit LE mono Buffer
 */
export async function enhanceAudio(pcmBuffer: Buffer): Promise<Buffer> {
  const start = Date.now();

  try {
    await ensureInitialized();

    // Reset processor state so independent chunks don't cross-contaminate.
    // Without this, the processor's internal FIR/IIR buffers retain data from
    // the previous chunk, causing the first outputDelay samples to contain
    // audio from a prior, unrelated buffer — garbling the beginning of every
    // enhanced chunk after the first.
    processor!.getProcessorContext().reset();

    const pcm24k = new Int16Array(
      pcmBuffer.buffer,
      pcmBuffer.byteOffset,
      pcmBuffer.byteLength / 2,
    );

    const pcm16k = downsample24kTo16k(pcm24k);
    const floats = int16ToFloat32(pcm16k);

    const inSamples16k = pcm16k.length;
    const expectedIn24k = pcm24k.length;
    console.log(
      `[BELLA:ENHANCE] Pipeline sizes — in24k=${expectedIn24k}samples(${pcmBuffer.length}bytes) ` +
        `in16k=${inSamples16k}samples(${inSamples16k * 2}bytes) floats=${floats.length}`,
    );

    const enhanced = new Float32Array(floats.length);
    const frameSize = optimalNumFrames;

    for (let offset = 0; offset < floats.length; offset += frameSize) {
      const end = Math.min(offset + frameSize, floats.length);
      const chunkLen = end - offset;

      const frame = new Float32Array(frameSize);
      frame.set(floats.subarray(offset, end));

      processor!.processInterleaved(frame);

      enhanced.set(frame.subarray(0, chunkLen), offset);
    }

    const enhancedInt16 = float32ToInt16(enhanced);
    const pcm24kOut = upsample16kTo24k(enhancedInt16);
    const outBuf = Buffer.from(pcm24kOut.buffer, pcm24kOut.byteOffset, pcm24kOut.byteLength);

    console.log(
      `[BELLA:ENHANCE] Enhanced audio — inBytes=${pcmBuffer.length} outBytes=${outBuf.length} ` +
        `out24kSamples=${pcm24kOut.length} elapsed=${Date.now() - start}ms`,
    );

    return outBuf;
  } catch (err) {
    console.error(`[BELLA:ENHANCE] Enhancement failed, using original audio — elapsed=${Date.now() - start}ms`, err);
    return pcmBuffer;
  }
}
