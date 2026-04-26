import pino from "pino";
import type { TTSStream } from "./types.ts";

const logger = pino({ name: "bella-gradium-tts" });

const DEFAULT_VOICE_ID = "YTpq7expH9539ERJ"; // Emma (en-US)
const WS_URL = "wss://api.gradium.ai/api/speech/tts";

/**
 * Gradium AI Text-to-Speech stream over a single persistent WebSocket.
 *
 * Opens one WebSocket on {@link connect} and keeps it alive for the entire
 * call session. Each {@link synthesize} call re-sends the `setup` message
 * (Gradium resets its session after every `end_of_stream`), waits for
 * `ready`, streams text + EOS, and fires {@link onAudio} for every chunk.
 *
 * The WebSocket is only closed when {@link close} is called explicitly
 * (typically at session teardown). If the server drops the connection
 * between synthesis calls, {@link ensureConnected} transparently reconnects.
 *
 * @example
 * ```ts
 * const tts = new GradiumTTSStream({ apiKey: process.env.GRADIUM_API_KEY! });
 * tts.onAudio = (base64) => queueAudioForTwilio(session, base64);
 * await tts.connect();
 * tts.synthesize("Hello, how can I help you today?");
 * // … later, another turn — same WebSocket, fresh setup
 * tts.synthesize("Your claim has been filed.");
 * // … session ends
 * tts.close();
 * ```
 */
export class GradiumTTSStream implements TTSStream {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private voiceId: string;

  /** Resolve/reject for the in-flight `waitForReady` promise. */
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;

  /** Whether the server has confirmed `ready` for the current setup. */
  private isReady = false;

  /** Set to true when the server closes the socket (not us). */
  private serverClosed = false;

  onAudio?: (audioBase64: string) => void;

  constructor(opts: { apiKey: string; voiceId?: string }) {
    this.apiKey = opts.apiKey;
    this.voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Open the WebSocket to Gradium, send the initial `setup`, and wait
   * for the first `ready` response. Call this once per call session.
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    this.serverClosed = false;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(WS_URL, {
        headers: {
          "x-api-key": this.apiKey,
          "x-api-source": "bella-ws-server",
        },
      } as unknown as string[]);

      const onOpen = () => {
        logger.info("[BELLA:TTS:GRADIUM] WebSocket opened");
        this.sendSetup();
      };

      const onMessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      const onError = (ev: Event) => {
        logger.error({ ev }, "[BELLA:TTS:GRADIUM] WebSocket error");
        reject(new Error("Gradium TTS WebSocket connection failed"));
      };

      const onClose = () => {
        logger.info("[BELLA:TTS:GRADIUM] WebSocket closed by server");
        this.ws = null;
        this.isReady = false;
        this.serverClosed = true;

        // Reject any pending ready wait so synthesize doesn't hang
        if (this.readyReject) {
          this.readyReject(new Error("WebSocket closed before ready"));
          this.readyResolve = null;
          this.readyReject = null;
        }
      };

      // We need the first `ready` to resolve the connect() promise.
      this.readyResolve = () => {
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
      };
      this.readyReject = (err: Error) => {
        this.readyResolve = null;
        this.readyReject = null;
        reject(err);
      };

      this.ws.addEventListener("open", onOpen);
      this.ws.addEventListener("message", onMessage);
      this.ws.addEventListener("error", onError);
      this.ws.addEventListener("close", onClose);
    });
  }

  /**
   * Reconnect if the server dropped the connection.
   * No-op when the WebSocket is still open.
   */
  async ensureConnected(): Promise<void> {
    if (this.isConnected) return;

    logger.info("[BELLA:TTS:GRADIUM] Reconnecting (server dropped connection)");
    await this.connect();
  }

  /**
   * Synthesize text to speech.
   *
   * Re-sends `setup` (Gradium resets after each EOS), waits for `ready`,
   * then sends the `text` and `end_of_stream` messages. Audio chunks
   * arrive via the {@link onAudio} callback as they stream in.
   *
   * @param text - The text to synthesize
   */
  synthesize(text: string): void {
    if (!this.isConnected) {
      logger.warn("[BELLA:TTS:GRADIUM] Cannot synthesize — not connected");
      return;
    }

    // After the previous EOS the session is reset, so re-send setup.
    if (!this.isReady) {
      this.sendSetup();
    }

    // Send text followed by end_of_stream
    this.ws!.send(JSON.stringify({ type: "text", text }));
    this.ws!.send(JSON.stringify({ type: "end_of_stream" }));

    logger.info(
      { textLen: text.length },
      "[BELLA:TTS:GRADIUM] Synthesis request sent",
    );
  }

  /**
   * Close the WebSocket. Call only when the call session is ending.
   */
  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // already closed
      }
      this.ws = null;
    }
    this.isReady = false;
    this.serverClosed = false;
    this.readyResolve = null;
    this.readyReject = null;
    logger.info("[BELLA:TTS:GRADIUM] Connection closed (session end)");
  }

  /** Send the `setup` message and mark as not-ready until server confirms. */
  private sendSetup(): void {
    this.isReady = false;
    this.ws!.send(
      JSON.stringify({
        type: "setup",
        voice_id: this.voiceId,
        model_name: "default",
        output_format: "ulaw_8000",
      }),
    );
    logger.debug("[BELLA:TTS:GRADIUM] Setup message sent");
  }

  /** Route incoming WebSocket messages to the appropriate handler. */
  private handleMessage(event: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      logger.warn("[BELLA:TTS:GRADIUM] Non-JSON message received");
      return;
    }

    switch (msg.type) {
      case "ready":
        this.isReady = true;
        logger.info("[BELLA:TTS:GRADIUM] Ready for synthesis");
        // Resolve any pending waitForReady (from connect or ensureConnected)
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
          this.readyReject = null;
        }
        break;

      case "audio":
        if (typeof msg.audio === "string") {
          this.onAudio?.(msg.audio);
        }
        break;

      case "end_of_stream":
        // Session resets — next synthesize will re-send setup.
        this.isReady = false;
        logger.debug("[BELLA:TTS:GRADIUM] End of stream — session reset, WS stays open");
        break;

      case "error":
        logger.error({ msg }, "[BELLA:TTS:GRADIUM] Error from server");
        break;

      default:
        logger.debug({ type: msg.type }, "[BELLA:TTS:GRADIUM] Unhandled message type");
    }
  }
}
