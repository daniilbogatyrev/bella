import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionManager } from '../../session';
import { generateStreamTwiML, parseTwilioMessage } from '../../twilio';

describe('Integration: Call Flow', () => {
  let manager: SessionManager;
  let sentMessages: string[];
  let mockWs: { send: (data: string) => void };

  beforeEach(() => {
    manager = new SessionManager();
    sentMessages = [];
    mockWs = { send: (data: string) => sentMessages.push(data) };
  });

  afterEach(() => {
    for (const session of manager.getActiveSessions()) {
      manager.endSession(session.callSid);
    }
  });

  it('TwiML generation produces valid XML for inbound call', () => {
    const twiml = generateStreamTwiML('wss://example.com/ws/stream', '+15551234567');
    expect(twiml).toContain('<?xml');
    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Connect>');
    expect(twiml).toContain('<Stream');
    expect(twiml).toContain('wss://example.com/ws/stream');
    expect(twiml).toContain('+15551234567');
  });

  it('full session lifecycle: create -> start -> end', () => {
    const session = manager.createSession('CA_TEST_INTEGRATION', mockWs);
    expect(session.status).toBe('initializing');

    const startMsg = JSON.stringify({
      event: 'start',
      sequenceNumber: '1',
      start: {
        streamSid: 'MZ_TEST',
        accountSid: 'AC_TEST',
        callSid: 'CA_TEST_INTEGRATION',
        tracks: ['inbound'],
        customParameters: { callerPhone: '+15559876543' },
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
      },
      streamSid: 'MZ_TEST',
    });

    manager.handleTwilioMessage('CA_TEST_INTEGRATION', startMsg);
    const activeSession = manager.getSession('CA_TEST_INTEGRATION');
    expect(activeSession).toBeDefined();
    expect(activeSession!.status).toBe('active');
    expect(activeSession!.streamSid).toBe('MZ_TEST');
    expect(activeSession!.callerPhone).toBe('+15559876543');

    manager.endSession('CA_TEST_INTEGRATION');
    expect(manager.getSession('CA_TEST_INTEGRATION')).toBeUndefined();
    expect(manager.getActiveSessions().length).toBe(0);
  });

  it('handles concurrent sessions independently', () => {
    const ws1Msgs: string[] = [];
    const ws2Msgs: string[] = [];

    manager.createSession('CA_1', { send: (d: string) => ws1Msgs.push(d) });
    manager.createSession('CA_2', { send: (d: string) => ws2Msgs.push(d) });

    for (const callSid of ['CA_1', 'CA_2']) {
      manager.handleTwilioMessage(
        callSid,
        JSON.stringify({
          event: 'start',
          sequenceNumber: '1',
          start: {
            streamSid: `MZ_${callSid}`,
            accountSid: 'AC_TEST',
            callSid,
            tracks: ['inbound'],
            customParameters: { callerPhone: `+1555${callSid}` },
            mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
          },
          streamSid: `MZ_${callSid}`,
        }),
      );
    }

    expect(manager.getActiveSessions().length).toBe(2);

    manager.endSession('CA_1');
    expect(manager.getActiveSessions().length).toBe(1);
    expect(manager.getSession('CA_2')!.status).toBe('active');
  });

  it('TwiML -> parseTwilioMessage round-trip: start event parsed correctly', () => {
    const startMsg = JSON.stringify({
      event: 'start',
      sequenceNumber: '1',
      start: {
        streamSid: 'MZ_RT',
        accountSid: 'AC_RT',
        callSid: 'CA_RT',
        tracks: ['inbound'],
        customParameters: { callerPhone: '+15551112222' },
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
      },
      streamSid: 'MZ_RT',
    });

    const parsed = parseTwilioMessage(startMsg);
    expect(parsed).not.toBeNull();
    expect(parsed!.event).toBe('start');

    if (parsed!.event === 'start') {
      expect(parsed!.start.streamSid).toBe('MZ_RT');
      expect(parsed!.start.callSid).toBe('CA_RT');
      expect(parsed!.start.customParameters.callerPhone).toBe('+15551112222');
    }
  });

  it('audio queue sends media and marks through WebSocket in order', () => {
    manager.createSession('CA_AQ', mockWs);

    manager.handleTwilioMessage(
      'CA_AQ',
      JSON.stringify({
        event: 'start',
        sequenceNumber: '1',
        start: {
          streamSid: 'MZ_AQ',
          accountSid: 'AC_AQ',
          callSid: 'CA_AQ',
          tracks: ['inbound'],
          customParameters: { callerPhone: '+15550000000' },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
        streamSid: 'MZ_AQ',
      }),
    );

    const session = manager.getSession('CA_AQ')!;
    manager.sendAudioToTwilio(session, 'chunk_1_base64');
    manager.sendAudioToTwilio(session, 'chunk_2_base64');

    manager.processAudioQueue(session);
    manager.processAudioQueue(session);

    expect(sentMessages.length).toBe(4);
    const media1 = JSON.parse(sentMessages[0]!);
    const mark1 = JSON.parse(sentMessages[1]!);
    const media2 = JSON.parse(sentMessages[2]!);
    const mark2 = JSON.parse(sentMessages[3]!);

    expect(media1.event).toBe('media');
    expect(media1.media.payload).toBe('chunk_1_base64');
    expect(mark1.event).toBe('mark');
    expect(mark1.mark.name).toBe('mark_1');
    expect(media2.event).toBe('media');
    expect(media2.media.payload).toBe('chunk_2_base64');
    expect(mark2.event).toBe('mark');
    expect(mark2.mark.name).toBe('mark_2');
  });

  it('stop event ends the session', () => {
    manager.createSession('CA_STOP', mockWs);

    manager.handleTwilioMessage(
      'CA_STOP',
      JSON.stringify({
        event: 'start',
        sequenceNumber: '1',
        start: {
          streamSid: 'MZ_STOP',
          accountSid: 'AC_STOP',
          callSid: 'CA_STOP',
          tracks: ['inbound'],
          customParameters: { callerPhone: '+15551234567' },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
        streamSid: 'MZ_STOP',
      }),
    );

    expect(manager.getSession('CA_STOP')).toBeDefined();

    manager.handleTwilioMessage(
      'CA_STOP',
      JSON.stringify({
        event: 'stop',
        sequenceNumber: '99',
        stop: { accountSid: 'AC_STOP', callSid: 'CA_STOP' },
        streamSid: 'MZ_STOP',
      }),
    );

    expect(manager.getSession('CA_STOP')).toBeUndefined();
  });
});
