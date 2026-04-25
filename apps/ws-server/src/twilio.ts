import type {
  TwilioMessage,
  TwilioOutgoingMedia,
  TwilioOutgoingMark,
  TwilioClearMessage,
} from './types';

const VALID_EVENTS = new Set(['connected', 'start', 'media', 'mark', 'stop']);

/**
 * Generate TwiML XML that connects an inbound call to a WebSocket media stream.
 *
 * @param wsUrl - The WebSocket URL to connect to (e.g. wss://domain.com/ws/stream)
 * @param callerPhone - The caller's phone number, passed as a custom parameter
 * @returns Valid TwiML XML string
 */
export function generateStreamTwiML(wsUrl: string, callerPhone: string): string {
  console.log(`[BELLA:TWILIO] Generating TwiML — wsUrl=${wsUrl} callerPhone=${callerPhone}`);
  const escapedPhone = escapeXml(callerPhone);
  const escapedUrl = escapeXml(wsUrl);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Connect>',
    `    <Stream url="${escapedUrl}">`,
    `      <Parameter name="callerPhone" value="${escapedPhone}" />`,
    '    </Stream>',
    '  </Connect>',
    '</Response>',
  ].join('\n');
}

/**
 * Parse and validate a raw Twilio WebSocket message.
 *
 * @param data - Raw message string or Buffer from the WebSocket
 * @returns Parsed TwilioMessage if valid, null otherwise
 */
export function parseTwilioMessage(data: string | Buffer): TwilioMessage | null {
  try {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !VALID_EVENTS.has(parsed.event)) {
      console.log(`[BELLA:TWILIO] Invalid/unknown event received: ${parsed?.event || 'undefined'}`);
      return null;
    }

    return parsed as TwilioMessage;
  } catch (err) {
    console.error(`[BELLA:TWILIO] Failed to parse Twilio message`, err);
    return null;
  }
}

/**
 * Create a JSON string for sending audio to the Twilio stream.
 *
 * @param streamSid - The Twilio stream SID
 * @param payload - Base64-encoded audio data (mulaw 8kHz)
 */
export function createMediaMessage(streamSid: string, payload: string): string {
  const msg: TwilioOutgoingMedia = {
    event: 'media',
    streamSid,
    media: { payload },
  };
  return JSON.stringify(msg);
}

/**
 * Create a JSON string for a mark message to track audio playback position.
 *
 * @param streamSid - The Twilio stream SID
 * @param markName - Unique name for this mark
 */
export function createMarkMessage(streamSid: string, markName: string): string {
  const msg: TwilioOutgoingMark = {
    event: 'mark',
    streamSid,
    mark: { name: markName },
  };
  return JSON.stringify(msg);
}

/**
 * Create a JSON string for clearing the Twilio audio queue (interrupt).
 *
 * @param streamSid - The Twilio stream SID
 */
export function createClearMessage(streamSid: string): string {
  const msg: TwilioClearMessage = {
    event: 'clear',
    streamSid,
  };
  return JSON.stringify(msg);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
