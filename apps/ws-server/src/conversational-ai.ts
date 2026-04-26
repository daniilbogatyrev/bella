import type { ServerWebSocket } from "bun";
import type { Session } from "./types.ts";
import { handleToolCall } from "./tools.ts";
import { getSystemPrompt } from "./llm.ts";
import { TOOL_DEFINITIONS } from "./llm.ts";
import { VOICE_MAP, type SupportedLanguage } from "./elevenlabs-tts.ts";
import { saveTranscript } from "./db.ts";
import { linearToMulaw, mulaw8kToPcm16k } from "./audio-utils.ts";
import { BackgroundNoiseGenerator } from "./bg-noise.ts";

/**
 * Build the ElevenLabs Conversational AI client tool definitions from
 * the existing LLM TOOL_DEFINITIONS.
 */
function buildConvAIToolDefinitions(): Array<{
  type: "client";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "client" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Manages a single ElevenLabs Conversational AI session that bridges
 * Twilio media streams to ElevenLabs' all-in-one speech-to-speech pipeline.
 *
 * Uses the **Agent + signed URL** flow:
 * 1. Fetch a signed WebSocket URL from the ElevenLabs REST API
 * 2. Connect to that URL (no API key in WebSocket headers)
 * 3. Send `conversation_initiation_client_data` with per-call overrides
 * 4. Bidirectionally stream audio and handle client tool calls
 *
 * Audio flow:
 * - Twilio (mulaw 8kHz base64) → ElevenLabs (user_audio_chunk)
 * - ElevenLabs (audio event PCM 16kHz base64) → Twilio (mulaw 8kHz media)
 */
export class ConversationalAISession {
  private ws: WebSocket | null = null;
  private session: Session;
  private streamSid: string;
  private twilioWs: ServerWebSocket<unknown>;
  private apiKey: string;
  private agentId: string;
  private closed = false;
  private collectedTranscripts: Array<{ role: "customer" | "agent"; content: string }> = [];
  private bgNoise: BackgroundNoiseGenerator;

  constructor(
    session: Session,
    streamSid: string,
    twilioWs: ServerWebSocket<unknown>,
    agentId: string,
  ) {
    this.session = session;
    this.streamSid = streamSid;
    this.twilioWs = twilioWs;
    this.apiKey = process.env.ELEVENLABS_API_KEY ?? "";
    this.agentId = agentId;
    this.bgNoise = new BackgroundNoiseGenerator();
  }

  /**
   * Fetch a signed WebSocket URL from ElevenLabs, connect, and send
   * the initial configuration with per-call overrides (customer context,
   * voice, and client tool definitions).
   */
  async connect(): Promise<void> {
    if (!this.apiKey) {
      throw new Error("ELEVENLABS_API_KEY is required for conversational_ai pipeline");
    }
    if (!this.agentId) {
      throw new Error("ELEVENLABS_AGENT_ID is required for conversational_ai pipeline");
    }

    const signedUrl = await this.getSignedUrl();

    const lang = (this.session.language || "en") as SupportedLanguage;
    const voiceEntry = VOICE_MAP[lang] ?? VOICE_MAP.en;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(signedUrl);

      const connectTimeout = setTimeout(() => {
        reject(new Error("ElevenLabs ConvAI connection timed out"));
      }, 15_000);

      this.ws.addEventListener("open", () => {
        this.session.logger.info(
          "[BELLA:CONVAI] WebSocket connected to signed URL, sending conversation_initiation_client_data",
        );

        const systemPrompt = getSystemPrompt(this.session);
        const greeting = this.buildGreeting();

        const initMessage = {
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: {
              prompt: {
                prompt: systemPrompt,
                tools: buildConvAIToolDefinitions(),
              },
              first_message: greeting,
              language: this.session.language || "en",
            },
            tts: {
              voice_id: voiceEntry.voiceId,
            },
          },
          custom_llm_extra_body: {},
        };

        this.ws!.send(JSON.stringify(initMessage));
      });

      this.ws.addEventListener("message", (event: MessageEvent) => {
        this.handleMessage(event);

        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "conversation_initiation_metadata") {
              clearTimeout(connectTimeout);
              this.session.logger.info(
                { conversationId: msg.conversation_initiation_metadata_event?.conversation_id },
                "[BELLA:CONVAI] Conversation initialized successfully",
              );
              this.bgNoise.start(this.streamSid, this.twilioWs);
              resolve();
            }
          } catch {
            // handled in handleMessage
          }
        }
      });

      this.ws.addEventListener("error", (ev: Event) => {
        this.session.logger.error({ ev }, "[BELLA:CONVAI] WebSocket error");
        clearTimeout(connectTimeout);
        reject(new Error("ElevenLabs ConvAI WebSocket connection failed"));
      });

      this.ws.addEventListener("close", (ev: CloseEvent) => {
        this.session.logger.info(
          { code: ev.code, reason: ev.reason },
          "[BELLA:CONVAI] WebSocket closed",
        );
        this.ws = null;
      });
    });
  }

  /**
   * Forward a base64-encoded audio chunk from Twilio to ElevenLabs.
   *
   * Twilio sends mulaw 8kHz audio. We convert to PCM 16-bit 16kHz
   * (the format ElevenLabs ConvAI expects for input).
   */
  sendAudio(base64Chunk: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const pcmBase64 = mulaw8kToPcm16k(base64Chunk);

    this.ws.send(
      JSON.stringify({
        user_audio_chunk: pcmBase64,
      }),
    );
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Build a brief plain-text summary from collected transcript exchanges.
   * Returns null if no transcripts were collected.
   */
  buildSummary(): string | null {
    if (this.collectedTranscripts.length === 0) return null;

    const lines = this.collectedTranscripts.map(
      (t) => `${t.role === "customer" ? "Customer" : "Agent"}: ${t.content}`,
    );

    const fullText = lines.join("\n");

    if (fullText.length <= 500) {
      return fullText;
    }

    return fullText.slice(0, 497) + "...";
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    this.session.logger.info("[BELLA:CONVAI] Closing ConversationalAI session");

    this.bgNoise.stop();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // already closed
      }
      this.ws = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch a signed WebSocket URL from ElevenLabs REST API.
   * The signed URL embeds the agent_id and a short-lived auth token,
   * so the WebSocket connection itself doesn't need API key headers.
   */
  private async getSignedUrl(): Promise<string> {
    const url = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.agentId}`;

    this.session.logger.info(
      { agentId: this.agentId },
      "[BELLA:CONVAI] Fetching signed WebSocket URL",
    );

    const res = await fetch(url, {
      headers: { "xi-api-key": this.apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Failed to get signed URL (${res.status}): ${body}`,
      );
    }

    const data = (await res.json()) as { signed_url: string };

    this.session.logger.info("[BELLA:CONVAI] Signed URL obtained");
    return data.signed_url;
  }

  private handleMessage(event: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      this.session.logger.warn("[BELLA:CONVAI] Non-JSON message received");
      return;
    }

    const type = msg.type as string;

    switch (type) {
      case "audio":
        this.handleAudioEvent(msg);
        break;

      case "client_tool_call":
        this.handleClientToolCall(msg);
        break;

      case "user_transcript":
        this.handleUserTranscript(msg);
        break;

      case "agent_response":
        this.handleAgentResponse(msg);
        break;

      case "interruption":
        this.handleInterruption();
        break;

      case "ping":
        this.handlePing(msg);
        break;

      case "conversation_initiation_metadata":
        break;

      default:
        this.session.logger.debug(
          { type },
          "[BELLA:CONVAI] Unhandled message type",
        );
    }
  }

  private handleAudioEvent(msg: Record<string, unknown>): void {
    const audioEvent = msg.audio_event as {
      audio_base_64: string;
      sample_rate: number;
    } | undefined;

    if (!audioEvent?.audio_base_64) return;

    this.bgNoise.pauseStandalone();

    // Decode PCM 16kHz and downsample to 8kHz (take every other sample)
    const pcmBuffer = Buffer.from(audioEvent.audio_base_64, "base64");
    const pcmSamples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
    const downsampledLength = Math.floor(pcmSamples.length / 2);

    // Get matching noise samples at 8kHz
    const noiseSamples = this.bgNoise.getNoiseChunkPCM(downsampledLength);

    // Mix voice + noise at PCM stage, then single mulaw encode
    const mulawBuffer = Buffer.alloc(downsampledLength);
    for (let i = 0; i < downsampledLength; i++) {
      const voice = pcmSamples[i * 2] ?? 0;
      const noise = noiseSamples[i] ?? 0;
      const mixed = Math.max(-32768, Math.min(32767, Math.round(voice * 0.96 + noise * 0.04)));
      mulawBuffer[i] = linearToMulaw(mixed);
    }

    this.sendToTwilio({
      event: "media",
      streamSid: this.streamSid,
      media: { payload: mulawBuffer.toString("base64") },
    });
  }

  /**
   * Handle a tool call from ElevenLabs by delegating to the existing
   * tool handler infrastructure in tools.ts, then return the result.
   */
  private async handleClientToolCall(msg: Record<string, unknown>): Promise<void> {
    const toolCall = msg.client_tool_call as {
      tool_call_id: string;
      tool_name: string;
      parameters: string;
    } | undefined;

    if (!toolCall) return;

    this.session.logger.info(
      { toolName: toolCall.tool_name, toolCallId: toolCall.tool_call_id },
      "[BELLA:CONVAI] Tool call received",
    );

    let args: Record<string, unknown>;
    try {
      args = typeof toolCall.parameters === "string"
        ? JSON.parse(toolCall.parameters)
        : (toolCall.parameters as Record<string, unknown>);
    } catch {
      args = {};
      this.session.logger.warn(
        { raw: toolCall.parameters },
        "[BELLA:CONVAI] Failed to parse tool parameters",
      );
    }

    try {
      const result = await handleToolCall(toolCall.tool_name, args, this.session);

      const responsePayload = {
        type: "client_tool_result",
        tool_call_id: toolCall.tool_call_id,
        result: JSON.stringify(result.response),
        is_error: false,
      };

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(responsePayload));
        this.session.logger.info(
          { toolName: toolCall.tool_name },
          "[BELLA:CONVAI] Tool result sent",
        );
      }

      if (this.session.endCallRequested) {
        this.session.logger.info(
          "[BELLA:CONVAI] end_call requested — session will close after agent finishes speaking",
        );
      }
    } catch (err) {
      this.session.logger.error(
        { err, toolName: toolCall.tool_name },
        "[BELLA:CONVAI] Tool execution failed",
      );

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "client_tool_result",
            tool_call_id: toolCall.tool_call_id,
            result: JSON.stringify({ error: "Tool execution failed" }),
            is_error: true,
          }),
        );
      }
    }
  }

  private handleUserTranscript(msg: Record<string, unknown>): void {
    const event = msg.user_transcription_event as {
      user_transcript: string;
    } | undefined;

    if (event?.user_transcript) {
      this.session.logger.info(
        { transcript: event.user_transcript },
        "[BELLA:CONVAI] User transcript",
      );

      this.collectedTranscripts.push({ role: "customer", content: event.user_transcript });

      saveTranscript({
        callSid: this.session.callId,
        role: "customer",
        content: event.user_transcript,
      }).catch((err) => {
        this.session.logger.error({ err }, "[BELLA:CONVAI] Failed to save user transcript");
      });
    }
  }

  private handleAgentResponse(msg: Record<string, unknown>): void {
    const event = msg.agent_response_event as {
      agent_response: string;
    } | undefined;

    if (event?.agent_response) {
      this.session.logger.info(
        { response: event.agent_response },
        "[BELLA:CONVAI] Agent response",
      );

      this.collectedTranscripts.push({ role: "agent", content: event.agent_response });

      saveTranscript({
        callSid: this.session.callId,
        role: "agent",
        content: event.agent_response,
      }).catch((err) => {
        this.session.logger.error({ err }, "[BELLA:CONVAI] Failed to save agent transcript");
      });
    }
  }

  /**
   * Handle barge-in — user interrupted the agent.
   * Clear any queued audio on the Twilio side.
   */
  private handleInterruption(): void {
    this.session.logger.info("[BELLA:CONVAI] User interrupted agent (barge-in)");

    this.sendToTwilio({
      event: "clear",
      streamSid: this.streamSid,
    });
  }

  /**
   * Respond to ping with pong, including the event_id for proper keepalive.
   */
  private handlePing(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const pingEvent = msg.ping_event as { event_id?: number } | undefined;
      this.ws.send(JSON.stringify({
        type: "pong",
        event_id: pingEvent?.event_id,
      }));
    }
  }

  private sendToTwilio(message: Record<string, unknown>): void {
    try {
      this.twilioWs.send(JSON.stringify(message));
    } catch (err) {
      this.session.logger.error(
        { err },
        "[BELLA:CONVAI] Failed to send to Twilio",
      );
    }
  }

  private buildGreeting(): string {
    const { customer } = this.session;

    if (customer) {
      return `Hi ${customer.firstName}, this is Bella from SafeGuard Insurance. How can I help you today?`;
    }

    return "Hi there, this is Bella from SafeGuard Insurance. How can I help you today?";
  }
}
