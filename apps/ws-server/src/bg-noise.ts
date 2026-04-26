/**
 * Background noise generator that produces continuous low-level call-center
 * ambiance for the Twilio audio stream.
 *
 * During silence (nobody speaking) it sends standalone noise chunks so the
 * caller hears a realistic environment instead of dead air. During agent
 * speech it mixes noise into the voice audio at a subtle 4% level.
 *
 * Audio format: mu-law 8-bit, 8 kHz, mono (Twilio standard).
 * Each chunk = 160 bytes = 20 ms at 8 kHz.
 *
 * @module bg-noise
 */

import type { ServerWebSocket } from "bun";
import { linearToMulaw } from "./audio-utils.ts";

/** 20 ms at 8 kHz = 160 samples (1 byte each in mu-law). */
const CHUNK_BYTES = 160;

/** How often we send a standalone noise chunk (ms). */
const SEND_INTERVAL_MS = 20;

/** After this many ms without agent audio, resume standalone noise. */
const RESUME_DELAY_MS = 100;

/** Amplitude of the noise in 16-bit PCM space (~5% of full scale). */
const NOISE_AMPLITUDE = 1600;

/**
 * Pre-generate a looping noise buffer to avoid per-chunk random generation.
 *
 * Produces ~1 second (8000 samples) of soft pink-ish noise — low-amplitude
 * random values smoothed by a simple moving-average filter to remove harsh
 * high-frequency content and approximate distant office chatter.
 */
function generateNoiseLoop(): Int16Array {
  const length = 8000;
  const raw = new Float64Array(length);

  // Box-Muller gaussian random
  for (let i = 0; i < length; i++) {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    raw[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // Simple 5-tap moving average low-pass to soften the noise
  const smoothed = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -2; j <= 2; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < length) {
        sum += raw[idx]!;
        count++;
      }
    }
    smoothed[i] = Math.round((sum / count) * NOISE_AMPLITUDE);
  }

  return smoothed;
}

/**
 * Manages continuous background noise for a single call.
 *
 * Lifecycle:
 * 1. `start(streamSid, twilioWs)` — begins sending standalone noise chunks
 * 2. When agent audio arrives, caller invokes `pauseStandalone()` then
 *    `mixWithVoice(voiceBase64)` for each voice chunk
 * 3. After a ~100 ms gap with no voice audio, standalone noise auto-resumes
 * 4. `stop()` — tears down the timer on call close
 */
export class BackgroundNoiseGenerator {
  private noiseLoop: Int16Array;
  private noiseMulawLoop: Uint8Array;
  private loopOffset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private streamSid: string | null = null;
  private twilioWs: ServerWebSocket<unknown> | null = null;
  private standalonePaused = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.noiseLoop = generateNoiseLoop();

    // Pre-encode the entire loop to mu-law for standalone sends
    this.noiseMulawLoop = new Uint8Array(this.noiseLoop.length);
    for (let i = 0; i < this.noiseLoop.length; i++) {
      this.noiseMulawLoop[i] = linearToMulaw(this.noiseLoop[i]!);
    }
  }

  /**
   * Begin sending standalone background noise chunks every 20 ms.
   *
   * @param streamSid - Twilio stream identifier for this call
   * @param twilioWs  - WebSocket connection to Twilio
   */
  start(streamSid: string, twilioWs: ServerWebSocket<unknown>): void {
    this.streamSid = streamSid;
    this.twilioWs = twilioWs;
    this.loopOffset = 0;
    this.standalonePaused = false;

    this.timer = setInterval(() => {
      if (this.standalonePaused || !this.twilioWs || !this.streamSid) return;
      this.sendNoiseChunk();
    }, SEND_INTERVAL_MS);
  }

  /** Stop all timers and release resources. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.twilioWs = null;
    this.streamSid = null;
  }

  /**
   * Pause the standalone noise stream (called when agent voice starts).
   * After {@link RESUME_DELAY_MS} ms without another pause, standalone
   * noise automatically resumes.
   */
  pauseStandalone(): void {
    this.standalonePaused = true;

    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
    }
    this.resumeTimer = setTimeout(() => {
      this.standalonePaused = false;
      this.resumeTimer = null;
    }, RESUME_DELAY_MS);
  }

  /**
   * Return raw PCM noise samples for mixing into voice audio.
   *
   * Advances the internal loop cursor so consecutive calls produce
   * a continuous noise stream without gaps or repeats.
   *
   * @param length - Number of 16-bit PCM samples to return
   * @returns Int16Array of noise samples at 8 kHz
   */
  getNoiseChunkPCM(length: number): Int16Array {
    const out = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = this.noiseLoop[this.loopOffset]!;
      this.advanceOffset();
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Send one 20 ms chunk of standalone noise to Twilio. */
  private sendNoiseChunk(): void {
    const chunk = Buffer.alloc(CHUNK_BYTES);

    for (let i = 0; i < CHUNK_BYTES; i++) {
      chunk[i] = this.noiseMulawLoop[this.loopOffset]!;
      this.advanceOffset();
    }

    try {
      this.twilioWs!.send(
        JSON.stringify({
          event: "media",
          streamSid: this.streamSid,
          media: { payload: chunk.toString("base64") },
        }),
      );
    } catch {
      // swallow — WS may have closed between check and send
    }
  }

  /** Advance the loop cursor, wrapping at the end. */
  private advanceOffset(): void {
    this.loopOffset = (this.loopOffset + 1) % this.noiseLoop.length;
  }
}
