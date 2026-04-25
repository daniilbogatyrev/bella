import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionManager } from '../session';

function createMockWs() {
  const sent: string[] = [];
  return {
    send: (data: string) => sent.push(data),
    sent,
  };
}

function makeStartMessage(callSid: string, streamSid: string, callerPhone: string) {
  return JSON.stringify({
    event: 'start',
    sequenceNumber: '1',
    start: {
      streamSid,
      accountSid: 'AC_test',
      callSid,
      tracks: ['inbound'],
      customParameters: { callerPhone },
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
    },
    streamSid,
  });
}

function makeMediaMessage(streamSid: string, payload: string) {
  return JSON.stringify({
    event: 'media',
    sequenceNumber: '5',
    media: { track: 'inbound', chunk: '1', timestamp: '100', payload },
    streamSid,
  });
}

function makeMarkMessage(streamSid: string, markName: string) {
  return JSON.stringify({
    event: 'mark',
    sequenceNumber: '10',
    mark: { name: markName },
    streamSid,
  });
}

function makeStopMessage(streamSid: string) {
  return JSON.stringify({
    event: 'stop',
    sequenceNumber: '99',
    stop: { accountSid: 'AC_test', callSid: 'CA_test' },
    streamSid,
  });
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  afterEach(() => {
    for (const session of manager.getActiveSessions()) {
      manager.endSession(session.callSid);
    }
  });

  describe('createSession', () => {
    it('creates a session with correct initial state', () => {
      const ws = createMockWs();
      const session = manager.createSession('CA_123', ws);

      expect(session.id).toBeTruthy();
      expect(session.callSid).toBe('CA_123');
      expect(session.streamSid).toBe('');
      expect(session.status).toBe('initializing');
      expect(session.conversationHistory).toEqual([]);
      expect(session.audioQueue).toEqual([]);
      expect(session.markSequence).toBe(0);
    });

    it('stores session retrievable by callSid', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const retrieved = manager.getSession('CA_123');
      expect(retrieved).toBeDefined();
      expect(retrieved!.callSid).toBe('CA_123');
    });
  });

  describe('handleTwilioMessage', () => {
    it('handles start event — sets streamSid, callerPhone, and activates', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      expect(session.streamSid).toBe('MZ_456');
      expect(session.callerPhone).toBe('+15551234567');
      expect(session.status).toBe('active');
    });

    it('handles media event without crashing', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const mediaMsg = makeMediaMessage('MZ_456', 'dGVzdA==');
      manager.handleTwilioMessage('CA_123', mediaMsg);

      const session = manager.getSession('CA_123');
      expect(session).toBeDefined();
      expect(session!.status).toBe('active');
    });

    it('handles mark event — tracks last mark name', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const markMsg = makeMarkMessage('MZ_456', 'mark_1');
      manager.handleTwilioMessage('CA_123', markMsg);

      const session = manager.getSession('CA_123');
      expect(session!.lastMarkName).toBe('mark_1');
    });

    it('handles stop event — ends and removes session', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const stopMsg = makeStopMessage('MZ_456');
      manager.handleTwilioMessage('CA_123', stopMsg);

      expect(manager.getSession('CA_123')).toBeUndefined();
    });

    it('ignores messages for non-existent sessions', () => {
      const mediaMsg = makeMediaMessage('MZ_456', 'dGVzdA==');
      // Should not throw
      manager.handleTwilioMessage('CA_nonexistent', mediaMsg);
    });

    it('handles invalid JSON gracefully', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);
      // Should not throw
      manager.handleTwilioMessage('CA_123', 'not valid json');
    });
  });

  describe('sendAudioToTwilio', () => {
    it('queues audio with incrementing mark names', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      manager.sendAudioToTwilio(session, 'audio_chunk_1');
      manager.sendAudioToTwilio(session, 'audio_chunk_2');

      expect(session.audioQueue).toHaveLength(2);
      expect(session.audioQueue[0]!.payload).toBe('audio_chunk_1');
      expect(session.audioQueue[0]!.markName).toBe('mark_1');
      expect(session.audioQueue[1]!.payload).toBe('audio_chunk_2');
      expect(session.audioQueue[1]!.markName).toBe('mark_2');
    });

    it('does not queue if session is not active', () => {
      const ws = createMockWs();
      const session = manager.createSession('CA_123', ws);
      // session is still 'initializing'
      manager.sendAudioToTwilio(session, 'audio_data');
      expect(session.audioQueue).toHaveLength(0);
    });
  });

  describe('processAudioQueue', () => {
    it('sends media and mark messages via WebSocket', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      manager.sendAudioToTwilio(session, 'audio_chunk');

      // Manually process queue
      manager.processAudioQueue(session);

      expect(ws.sent).toHaveLength(2); // media + mark
      const mediaSent = JSON.parse(ws.sent[0]!);
      expect(mediaSent.event).toBe('media');
      expect(mediaSent.media.payload).toBe('audio_chunk');

      const markSent = JSON.parse(ws.sent[1]!);
      expect(markSent.event).toBe('mark');
      expect(markSent.mark.name).toBe('mark_1');

      expect(session.audioQueue).toHaveLength(0);
    });

    it('does nothing when queue is empty', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      manager.processAudioQueue(session);

      expect(ws.sent).toHaveLength(0);
    });
  });

  describe('endSession', () => {
    it('clears audio queue and removes session', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      manager.sendAudioToTwilio(session, 'audio');
      expect(session.audioQueue).toHaveLength(1);

      manager.endSession('CA_123');

      expect(manager.getSession('CA_123')).toBeUndefined();
      expect(session.status).toBe('closed');
      expect(session.audioQueue).toHaveLength(0);
    });

    it('does nothing for non-existent session', () => {
      manager.endSession('CA_nonexistent'); // Should not throw
    });
  });

  describe('getActiveSessions', () => {
    it('returns all active sessions', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      manager.createSession('CA_1', ws1);
      manager.createSession('CA_2', ws2);

      const active = manager.getActiveSessions();
      expect(active).toHaveLength(2);
    });

    it('excludes ended sessions', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      manager.createSession('CA_1', ws1);
      manager.createSession('CA_2', ws2);
      manager.endSession('CA_1');

      const active = manager.getActiveSessions();
      expect(active).toHaveLength(1);
      expect(active[0]!.callSid).toBe('CA_2');
    });
  });
});
