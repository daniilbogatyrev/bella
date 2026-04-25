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
    it('chunks audio into 160-byte segments with mark on last chunk', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;

      // 320 bytes of mulaw = 2 chunks of 160 bytes each
      const rawAudio = Buffer.alloc(320, 0x7f);
      const b64 = rawAudio.toString('base64');
      manager.sendAudioToTwilio(session, b64);

      expect(session.audioQueue).toHaveLength(2);
      expect(session.audioQueue[0]!.markName).toBeUndefined();
      expect(session.audioQueue[1]!.markName).toBe('mark_1');

      // Each chunk should decode to exactly 160 bytes
      const chunk0Bytes = Buffer.from(session.audioQueue[0]!.payload, 'base64');
      const chunk1Bytes = Buffer.from(session.audioQueue[1]!.payload, 'base64');
      expect(chunk0Bytes.length).toBe(160);
      expect(chunk1Bytes.length).toBe(160);
    });

    it('handles audio smaller than one chunk', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;

      // 80 bytes = less than one full 160-byte chunk
      const rawAudio = Buffer.alloc(80, 0x7f);
      manager.sendAudioToTwilio(session, rawAudio.toString('base64'));

      expect(session.audioQueue).toHaveLength(1);
      expect(session.audioQueue[0]!.markName).toBe('mark_1');
      const decoded = Buffer.from(session.audioQueue[0]!.payload, 'base64');
      expect(decoded.length).toBe(80);
    });

    it('increments mark sequence across multiple sends', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;

      const small = Buffer.alloc(160, 0x7f).toString('base64');
      manager.sendAudioToTwilio(session, small);
      manager.sendAudioToTwilio(session, small);

      // 2 sends × 1 chunk each = 2 items
      expect(session.audioQueue).toHaveLength(2);
      expect(session.audioQueue[0]!.markName).toBe('mark_1');
      expect(session.audioQueue[1]!.markName).toBe('mark_2');
    });

    it('does not queue if session is not active', () => {
      const ws = createMockWs();
      const session = manager.createSession('CA_123', ws);
      // session is still 'initializing'
      manager.sendAudioToTwilio(session, Buffer.alloc(160, 0x7f).toString('base64'));
      expect(session.audioQueue).toHaveLength(0);
    });

    it('does not queue if audio is empty', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      manager.sendAudioToTwilio(session, '');
      expect(session.audioQueue).toHaveLength(0);
    });
  });

  describe('continuous background loop', () => {
    it('sends queued TTS chunks and marks via WebSocket when loop ticks', async () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      // Clear any bg-only chunks already sent by the loop
      ws.sent.length = 0;

      // Send exactly 160 bytes = 1 chunk (gets mark)
      const oneChunk = Buffer.alloc(160, 0x7f).toString('base64');
      manager.sendAudioToTwilio(session, oneChunk, 'test');
      expect(session.audioQueue).toHaveLength(1);

      // Wait for loop to send the chunk (20ms interval + margin)
      await Bun.sleep(80);

      // Find media and mark messages among everything sent (bg-only + TTS)
      const mediaMsgs = ws.sent.filter(m => { try { return JSON.parse(m).event === 'media'; } catch { return false; } });
      const markMsgs = ws.sent.filter(m => { try { return JSON.parse(m).event === 'mark'; } catch { return false; } });
      expect(mediaMsgs.length).toBeGreaterThanOrEqual(1);
      expect(markMsgs.length).toBeGreaterThanOrEqual(1);

      const lastMark = JSON.parse(markMsgs[markMsgs.length - 1]!);
      expect(lastMark.mark.name).toBe('mark_1');

      expect(session.audioQueue).toHaveLength(0);
    });

    it('sends one TTS chunk per tick and leaves the rest queued', async () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      ws.sent.length = 0;

      // 480 bytes = 3 chunks
      const audio = Buffer.alloc(480, 0x7f).toString('base64');
      manager.sendAudioToTwilio(session, audio, 'test');
      expect(session.audioQueue).toHaveLength(3);

      // Wait for 1 tick
      await Bun.sleep(30);
      expect(session.audioQueue.length).toBeLessThanOrEqual(2);

      // Wait for all chunks to drain
      await Bun.sleep(100);
      expect(session.audioQueue).toHaveLength(0);
    });

    it('sends background-only chunks when no TTS audio is queued', async () => {
      // Temporarily enable bg noise for this test
      const prevBgEnabled = process.env.BG_NOISE_ENABLED;
      process.env.BG_NOISE_ENABLED = 'true';

      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      // Wait for the continuous loop to fire several ticks (20ms interval)
      await new Promise(resolve => setTimeout(resolve, 150));

      const mediaMsgs = ws.sent.filter(m => { try { return JSON.parse(m).event === 'media'; } catch { return false; } });
      expect(mediaMsgs.length).toBeGreaterThanOrEqual(1);

      // Restore env
      if (prevBgEnabled === undefined) delete process.env.BG_NOISE_ENABLED;
      else process.env.BG_NOISE_ENABLED = prevBgEnabled;
    });
  });

  describe('endSession', () => {
    it('clears audio queue and removes session', () => {
      const ws = createMockWs();
      manager.createSession('CA_123', ws);

      const startMsg = makeStartMessage('CA_123', 'MZ_456', '+15551234567');
      manager.handleTwilioMessage('CA_123', startMsg);

      const session = manager.getSession('CA_123')!;
      const audio = Buffer.alloc(160, 0x7f).toString('base64');
      manager.sendAudioToTwilio(session, audio);
      expect(session.audioQueue.length).toBeGreaterThan(0);

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
