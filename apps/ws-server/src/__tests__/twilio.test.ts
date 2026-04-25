import { describe, it, expect } from 'bun:test';
import {
  generateStreamTwiML,
  parseTwilioMessage,
  createMediaMessage,
  createMarkMessage,
  createClearMessage,
} from '../twilio';

describe('Twilio Helpers', () => {
  describe('generateStreamTwiML', () => {
    it('generates valid TwiML with stream URL and caller phone', () => {
      const twiml = generateStreamTwiML('wss://example.com/ws/stream', '+15551234567');
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Connect>');
      expect(twiml).toContain('<Stream url="wss://example.com/ws/stream">');
      expect(twiml).toContain('name="callerPhone"');
      expect(twiml).toContain('value="+15551234567"');
      expect(twiml).toContain('</Stream>');
      expect(twiml).toContain('</Connect>');
      expect(twiml).toContain('</Response>');
    });

    it('escapes XML special characters in phone number', () => {
      const twiml = generateStreamTwiML('wss://example.com/ws', '<script>&bad"');
      expect(twiml).toContain('&lt;script&gt;&amp;bad&quot;');
      expect(twiml).not.toContain('<script>');
    });

    it('escapes XML special characters in URL', () => {
      const twiml = generateStreamTwiML('wss://example.com/ws?a=1&b=2', '+1555');
      expect(twiml).toContain('wss://example.com/ws?a=1&amp;b=2');
    });
  });

  describe('parseTwilioMessage', () => {
    it('parses a valid start event', () => {
      const startMsg = JSON.stringify({
        event: 'start',
        sequenceNumber: '1',
        start: {
          streamSid: 'MZ123',
          accountSid: 'AC123',
          callSid: 'CA123',
          tracks: ['inbound'],
          customParameters: { callerPhone: '+15551234567' },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
        streamSid: 'MZ123',
      });

      const result = parseTwilioMessage(startMsg);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('start');
    });

    it('parses a valid media event', () => {
      const mediaMsg = JSON.stringify({
        event: 'media',
        sequenceNumber: '5',
        media: {
          track: 'inbound',
          chunk: '1',
          timestamp: '100',
          payload: 'dGVzdA==',
        },
        streamSid: 'MZ123',
      });

      const result = parseTwilioMessage(mediaMsg);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('media');
    });

    it('parses a valid connected event', () => {
      const msg = JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' });
      const result = parseTwilioMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('connected');
    });

    it('parses a valid mark event', () => {
      const msg = JSON.stringify({
        event: 'mark',
        sequenceNumber: '10',
        mark: { name: 'mark_1' },
        streamSid: 'MZ123',
      });
      const result = parseTwilioMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('mark');
    });

    it('parses a valid stop event', () => {
      const msg = JSON.stringify({
        event: 'stop',
        sequenceNumber: '99',
        stop: { accountSid: 'AC123', callSid: 'CA123' },
        streamSid: 'MZ123',
      });
      const result = parseTwilioMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('stop');
    });

    it('returns null for invalid JSON', () => {
      expect(parseTwilioMessage('not json')).toBeNull();
    });

    it('returns null for unknown event type', () => {
      expect(parseTwilioMessage(JSON.stringify({ event: 'unknown' }))).toBeNull();
    });

    it('returns null for missing event field', () => {
      expect(parseTwilioMessage(JSON.stringify({ data: 'test' }))).toBeNull();
    });

    it('handles Buffer input', () => {
      const buf = Buffer.from(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
      const result = parseTwilioMessage(buf);
      expect(result).not.toBeNull();
      expect(result!.event).toBe('connected');
    });
  });

  describe('createMediaMessage', () => {
    it('creates a valid media message JSON', () => {
      const msg = createMediaMessage('MZ123', 'dGVzdA==');
      const parsed = JSON.parse(msg);
      expect(parsed.event).toBe('media');
      expect(parsed.streamSid).toBe('MZ123');
      expect(parsed.media.payload).toBe('dGVzdA==');
    });
  });

  describe('createMarkMessage', () => {
    it('creates a valid mark message JSON', () => {
      const msg = createMarkMessage('MZ123', 'mark_1');
      const parsed = JSON.parse(msg);
      expect(parsed.event).toBe('mark');
      expect(parsed.streamSid).toBe('MZ123');
      expect(parsed.mark.name).toBe('mark_1');
    });
  });

  describe('createClearMessage', () => {
    it('creates a valid clear message JSON', () => {
      const msg = createClearMessage('MZ123');
      const parsed = JSON.parse(msg);
      expect(parsed.event).toBe('clear');
      expect(parsed.streamSid).toBe('MZ123');
    });
  });
});
