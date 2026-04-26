import type { ServerWebSocket } from "bun";
import type { Logger } from "pino";

/** Insurance product types supported by SafeGuard */
export type InsuranceType =
  | "auto"
  | "health"
  | "liability"
  | "home"
  | "life"
  | "travel";

/** Claim lifecycle status */
export type ClaimStatus =
  | "draft"
  | "gathering_info"
  | "ready_for_review"
  | "submitted"
  | "under_review"
  | "approved"
  | "denied"
  | "closed";

/** Voice agent processing state */
export type AssistantState =
  | "idle"
  | "idle_listening"
  | "active_listening"
  | "processing"
  | "responding";

/** Customer record from DB lookup */
export interface Customer {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  address: string;
}

/** Policy record from DB lookup */
export interface Policy {
  id: string;
  customerId: string;
  type: InsuranceType;
  planName: string;
  status: string;
  startDate: string;
  endDate: string;
  details: Record<string, unknown>;
}

/** Open claim record */
export interface Claim {
  id: string;
  customerId: string;
  policyId: string | null;
  type: InsuranceType;
  status: ClaimStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/** Common interface for all TTS stream implementations */
export interface TTSStream {
  /** Open the connection to the TTS service */
  connect(): Promise<void>;

  /** Send text to be synthesized; audio arrives via the onAudio callback */
  synthesize(text: string): void;

  /** Gracefully close the TTS connection */
  close(): void;

  /** Whether the underlying connection is open and ready */
  readonly isConnected: boolean;

  /** Called for each audio chunk produced by the TTS engine (base64 mulaw) */
  onAudio?: (audioBase64: string) => void;
}

/** Audio chunk queued for Twilio playback */
export type AudioQueueItem =
  | { audioInBase64: string }
  | { clearQueueInTwilio: true };

/**
 * Represents a single active phone call session.
 *
 * Tracks the WebSocket connection to Twilio, audio queue state,
 * customer context, and all lifecycle flags needed to manage
 * the call from start to graceful teardown.
 */
export interface Session {
  /** Unique call identifier (Twilio CallSid) */
  callId: string;

  /** Twilio media stream identifier, set on "start" event */
  streamSid: string | undefined;

  /** WebSocket connection back to Twilio */
  twilioWs: ServerWebSocket<unknown>;

  /** Queued audio chunks waiting to be sent to Twilio */
  sendQueue: AudioQueueItem[];

  /** Interval handle for the audio queue processor */
  sendQueueInterval: ReturnType<typeof setInterval> | undefined;

  /** Current voice agent state */
  assistantState: AssistantState;

  /** Monotonically increasing sequence number for Twilio mark events */
  sequenceNumber: number;

  /** The last sequence number that was sent before an end-call request */
  lastSeqNumber: number;

  /**
   * When true, the session will close all connections after the
   * final audio chunk (identified by mark event) finishes playing.
   */
  shouldCloseAfterMark: boolean;

  /**
   * Set to true when the LLM calls the end_call tool.
   * The session will play the final goodbye TTS, then gracefully disconnect.
   */
  endCallRequested: boolean;

  /** Prevents duplicate cleanup on concurrent close paths */
  alreadyClosing: boolean;

  /** Session-scoped logger */
  logger: Logger;

  /** Resolved customer record (null until lookup completes) */
  customer: Customer | null;

  /** Customer's active policies */
  policies: Policy[];

  /** Currently active claim for this call session */
  activeClaim: Claim | null;

  /** Gemini conversation history for multi-turn context */
  conversationHistory: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }>;

  /** ISO timestamp of when the session started */
  startedAt: string;

  /** Timer handle for the 9-minute max call duration auto-complete */
  maxDurationTimer: ReturnType<typeof setTimeout> | undefined;

  /** Caller phone number from Twilio (E.164 format) */
  callerPhone: string | null;

  /** Active TTS stream for this session (needed for voice switching) */
  ttsStream: TTSStream | null;

  /** Current conversation language (ISO 639-1 code) */
  language: string;

  /** Facts logged before a claim is opened — flushed when open_claim is called */
  pendingFacts: Array<{ content: string; category?: string }>;

  /** Summary of the call conversation, generated when the call ends */
  callSummary: string | null;
}
