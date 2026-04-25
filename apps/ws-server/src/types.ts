/** Twilio Media Stream connected event — sent when connection is established. */
export interface TwilioConnectedEvent {
  event: 'connected';
  protocol: string;
  version: string;
}

/** Twilio Media Stream start event — contains stream metadata and caller info. */
export interface TwilioStartEvent {
  event: 'start';
  sequenceNumber: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  streamSid: string;
}

/** Twilio Media Stream media event — contains base64-encoded audio chunk. */
export interface TwilioMediaEvent {
  event: 'media';
  sequenceNumber: string;
  media: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  streamSid: string;
}

/** Twilio Media Stream mark event — confirms playback reached a mark point. */
export interface TwilioMarkEvent {
  event: 'mark';
  sequenceNumber: string;
  mark: { name: string };
  streamSid: string;
}

/** Twilio Media Stream stop event — stream is ending. */
export interface TwilioStopEvent {
  event: 'stop';
  sequenceNumber: string;
  stop: { accountSid: string; callSid: string };
  streamSid: string;
}

export type TwilioMessage =
  | TwilioConnectedEvent
  | TwilioStartEvent
  | TwilioMediaEvent
  | TwilioMarkEvent
  | TwilioStopEvent;

export interface TwilioOutgoingMedia {
  event: 'media';
  streamSid: string;
  media: { payload: string };
}

export interface TwilioOutgoingMark {
  event: 'mark';
  streamSid: string;
  mark: { name: string };
}

export interface TwilioClearMessage {
  event: 'clear';
  streamSid: string;
}

export interface ConversationMessage {
  role: 'user' | 'model' | 'function';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
}

export interface AudioQueueItem {
  payload: string;
  markName?: string;
}

/**
 * Tracks TTS audio playback progress so barge-in can determine
 * what portion of the response the caller actually heard.
 */
export interface PlaybackState {
  /** The complete LLM response text being played. */
  fullText: string;
  /** Total audio chunks queued for this response. */
  totalChunks: number;
  /** Chunks actually sent to Twilio so far. */
  sentChunks: number;
  /** Whether TTS audio is currently being played to the caller. */
  isPlaying: boolean;
  /** The mark name for the current playback (set when queue empties). */
  currentMark?: string;
}

/**
 * Handle for a per-session ElevenLabs WebSocket STT stream.
 * Created on session start, closed on session end.
 */
export interface ElevenLabsSTTStream {
  /** Forward a base64-encoded mulaw audio chunk to the ElevenLabs WS. */
  sendAudio(mulawBase64: string): void;
  /** Gracefully close the WebSocket connection. */
  close(): void;
}

export interface Session {
  id: string;
  callSid: string;
  streamSid: string;
  callerPhone: string;
  customerId?: string;
  claimId?: string;
  ws: { send: (data: string) => void };
  conversationHistory: ConversationMessage[];
  audioQueue: AudioQueueItem[];
  audioBuffer: string[];
  audioBufferBytes: number;
  /** Continuous background audio loop interval — sends bg noise even between TTS turns. */
  bgInterval?: ReturnType<typeof setInterval>;
  lastMarkName?: string;
  markSequence: number;
  status: 'initializing' | 'active' | 'closing' | 'closed';
  processing: boolean;
  startedAt: Date;
  dbSessionId?: string;
  playback: PlaybackState;
  /** Current position in the background noise audio loop (per session). */
  bgSeekPosition: number;
  /** Per-session ElevenLabs WebSocket STT stream (only when STT_PROVIDER=elevenlabs). */
  sttStream?: ElevenLabsSTTStream;
}
