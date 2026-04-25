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
 * Client for Gradium AI speech-to-text and text-to-speech APIs.
 *
 * Handles mulaw 8kHz audio in/out, matching Twilio Media Stream format.
 * Audio is transmitted as base64-encoded payloads.
 *
 * @example
 * ```ts
 * const client = new GradiumClient({ apiKey: '...', baseUrl: 'https://api.gradium.ai' });
 * const transcript = await client.speechToText(audioBase64);
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
   * Transcribe base64-encoded mulaw audio to text.
   *
   * @param audioBase64 - Base64-encoded mulaw 8kHz audio
   * @returns Transcribed text string
   * @throws Error if the Gradium STT API returns a non-OK response
   */
  async speechToText(audioBase64: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio: audioBase64,
        model: this.config.sttModel || 'whisper-large-v3',
        encoding: 'mulaw',
        sample_rate: 8000,
        language: 'en',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'STT request failed');
      throw new Error(`Gradium STT failed: ${response.status} ${error}`);
    }

    const result = (await response.json()) as { text: string };
    return result.text || '';
  }

  /**
   * Convert text to base64-encoded mulaw audio for Twilio playback.
   *
   * @param text - Text to synthesize
   * @returns Base64-encoded mulaw 8kHz audio
   * @throws Error if the Gradium TTS API returns a non-OK response
   */
  async textToSpeech(text: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: this.config.ttsModel || 'tts-1',
        voice: this.config.ttsVoice || 'nova',
        response_format: 'mulaw',
        sample_rate: 8000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'TTS request failed');
      throw new Error(`Gradium TTS failed: ${response.status} ${error}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return Buffer.from(audioBuffer).toString('base64');
  }
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
