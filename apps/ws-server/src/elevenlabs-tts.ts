import pino from "pino";
import type { TTSStream } from "./types.ts";

const logger = pino({ name: "bella-elevenlabs-tts" });

/** Supported language codes for voice selection */
export type SupportedLanguage = "en" | "de" | "es";

/**
 * Voice entry mapping a language to a specific ElevenLabs voice.
 *
 * @param voiceId - ElevenLabs voice identifier
 * @param name - Human-readable voice name (for logging)
 */
export interface VoiceEntry {
  voiceId: string;
  name: string;
}

/**
 * Per-language voice map.
 *
 * Jessica (`cgSgspJ2msm6clMCkdW9`) — conversational, warm, playful, bright.
 * Verified by ElevenLabs for English, German, and Spanish.
 * Best-in-class for phone call naturalness across all three languages.
 *
 * Override individual voices via `ELEVENLABS_VOICE_EN`, `ELEVENLABS_VOICE_DE`,
 * `ELEVENLABS_VOICE_ES` environment variables.
 */
export const VOICE_MAP: Record<SupportedLanguage, VoiceEntry> = {
  en: {
    voiceId: process.env.ELEVENLABS_VOICE_EN || "cgSgspJ2msm6clMCkdW9",
    name: "Jessica",
  },
  de: {
    voiceId: process.env.ELEVENLABS_VOICE_DE || "cgSgspJ2msm6clMCkdW9",
    name: "Jessica",
  },
  es: {
    voiceId: process.env.ELEVENLABS_VOICE_ES || "cgSgspJ2msm6clMCkdW9",
    name: "Jessica",
  },
};

const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/**
 * Flash v2 — low-latency, multilingual. Compatible with English Conversational AI
 * agents while also supporting DE, ES, and other languages.
 */
const DEFAULT_MODEL = "eleven_flash_v2";

/**
 * ElevenLabs Text-to-Speech stream over WebSocket.
 *
 * Connects to the ElevenLabs streaming TTS WebSocket endpoint and outputs
 * base64-encoded audio chunks. The output format is `ulaw_8000` (mulaw 8 kHz)
 * so chunks can be forwarded to Twilio without conversion.
 *
 * Supports runtime language switching via {@link setLanguage}. Changing the
 * language closes the current WebSocket and reconnects with the new voice ID.
 *
 * @example
 * ```ts
 * const tts = new ElevenLabsTTSStream({
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 * });
 * tts.onAudio = (base64) => queueAudioForTwilio(session, base64);
 * await tts.connect();
 * tts.synthesize("Hello, how can I help you today?");
 *
 * // Switch to German mid-call
 * await tts.setLanguage("de");
 * tts.synthesize("Hallo, wie kann ich Ihnen helfen?");
 * ```
 */
export class ElevenLabsTTSStream implements TTSStream {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private voiceId: string;
  private model: string;
  private language: SupportedLanguage;

  onAudio?: (audioBase64: string) => void;

  constructor(opts: {
    apiKey: string;
    voiceId?: string;
    model?: string;
    language?: SupportedLanguage;
  }) {
    this.apiKey = opts.apiKey;
    this.language = opts.language ?? DEFAULT_LANGUAGE;
    this.voiceId =
      opts.voiceId ?? VOICE_MAP[this.language]?.voiceId ?? VOICE_MAP.en.voiceId;
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentLanguage(): SupportedLanguage {
    return this.language;
  }

  get currentVoiceId(): string {
    return this.voiceId;
  }

  async connect(): Promise<void> {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input` +
      `?model_id=${this.model}&output_format=ulaw_8000`;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);

      const onOpen = () => {
        this.ws!.send(
          JSON.stringify({
            text: " ",
            xi_api_key: this.apiKey,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              use_speaker_boost: false,
            },
          }),
        );
        logger.info(
          { voiceId: this.voiceId, language: this.language, model: this.model },
          "[BELLA:TTS:11LABS] Connected and ready",
        );
        resolve();
      };

      const onMessage = (event: MessageEvent) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          logger.warn("[BELLA:TTS:11LABS] Non-JSON message received");
          return;
        }

        if (typeof msg.audio === "string" && msg.audio.length > 0) {
          this.onAudio?.(msg.audio);
        }

        if (msg.error) {
          logger.error({ msg }, "[BELLA:TTS:11LABS] Error from server");
        }
      };

      const onError = (ev: Event) => {
        logger.error({ ev }, "[BELLA:TTS:11LABS] WebSocket error");
        reject(new Error("ElevenLabs TTS WebSocket connection failed"));
      };

      const onClose = () => {
        logger.info("[BELLA:TTS:11LABS] WebSocket closed");
        this.ws = null;
      };

      this.ws.addEventListener("open", onOpen);
      this.ws.addEventListener("message", onMessage);
      this.ws.addEventListener("error", onError);
      this.ws.addEventListener("close", onClose);
    });
  }

  /**
   * Switch the TTS voice to the one mapped to the given language.
   *
   * The ElevenLabs streaming WebSocket encodes the voice ID in the URL,
   * so changing voice requires closing the current connection and opening
   * a new one. The `onAudio` callback is preserved across reconnections.
   *
   * @param lang - Target language code (`en`, `de`, or `es`)
   * @throws If reconnection fails
   */
  async setLanguage(lang: SupportedLanguage): Promise<void> {
    const entry = VOICE_MAP[lang];
    if (!entry) {
      logger.warn({ lang }, "[BELLA:TTS:11LABS] Unsupported language requested");
      return;
    }

    if (lang === this.language && entry.voiceId === this.voiceId) {
      return;
    }

    const previousLang = this.language;
    this.language = lang;
    this.voiceId = entry.voiceId;

    logger.info(
      {
        language: lang,
        voice: entry.name,
        voiceId: entry.voiceId,
        previousLanguage: previousLang,
      },
      "[BELLA:TTS:11LABS] Voice changed",
    );

    if (this.isConnected) {
      this.close();
      await this.connect();
    }
  }

  synthesize(text: string): void {
    if (!this.isConnected) {
      logger.warn("[BELLA:TTS:11LABS] Cannot synthesize — not connected");
      return;
    }

    this.ws!.send(
      JSON.stringify({
        text,
        try_trigger_generation: true,
      }),
    );
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.send(JSON.stringify({ text: "" }));
        this.ws.close();
      } catch {
        // already closed
      }
      this.ws = null;
    }
  }
}
