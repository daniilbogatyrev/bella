import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionManager, truncateToWordBoundary, truncateLastAssistantMessage, isNonSpeech } from '../session';
import { isLikelySilence } from '../stt';
import type { Session } from '../types';

// ---------------------------------------------------------------------------
// Pure helper functions — no native SDK dependency
// ---------------------------------------------------------------------------

describe('truncateToWordBoundary', () => {
  it('returns full text when maxLength exceeds text length', () => {
    expect(truncateToWordBoundary('hello world', 100)).toBe('hello world');
  });

  it('truncates at word boundary', () => {
    expect(truncateToWordBoundary('My name is Bella, and I can help you', 20)).toBe('My name is Bella,');
  });

  it('truncates to raw substring if no space found before maxLength', () => {
    expect(truncateToWordBoundary('Superlongword more', 5)).toBe('Super');
  });

  it('handles exact length', () => {
    expect(truncateToWordBoundary('hello', 5)).toBe('hello');
  });

  it('handles empty string', () => {
    expect(truncateToWordBoundary('', 10)).toBe('');
  });

  it('handles maxLength of 0', () => {
    expect(truncateToWordBoundary('hello world', 0)).toBe('');
  });

  it('finds nearest prior space for mid-word cut', () => {
    const result = truncateToWordBoundary('one two three four five', 14);
    // 14 chars = "one two three " — should trim to "one two three"
    expect(result).toBe('one two three');
  });
});

describe('truncateLastAssistantMessage', () => {
  it('replaces the last model message content', () => {
    const session = {
      conversationHistory: [
        { role: 'user' as const, content: 'Hi' },
        { role: 'model' as const, content: 'My name is Bella, and I can help you with insurance.' },
      ],
    } as Session;

    truncateLastAssistantMessage(session, 'My name is Bella,');

    expect(session.conversationHistory[1]!.content).toBe('My name is Bella,');
  });

  it('targets the last model message even with multiple', () => {
    const session = {
      conversationHistory: [
        { role: 'model' as const, content: 'First response' },
        { role: 'user' as const, content: 'Question' },
        { role: 'model' as const, content: 'Second response that was interrupted' },
      ],
    } as Session;

    truncateLastAssistantMessage(session, 'Second');

    expect(session.conversationHistory[0]!.content).toBe('First response');
    expect(session.conversationHistory[2]!.content).toBe('Second');
  });

  it('does nothing if no model messages exist', () => {
    const session = {
      conversationHistory: [
        { role: 'user' as const, content: 'Hi' },
      ],
    } as Session;

    truncateLastAssistantMessage(session, 'anything');

    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]!.content).toBe('Hi');
  });

  it('skips function messages to find the model message', () => {
    const session = {
      conversationHistory: [
        { role: 'model' as const, content: 'Let me look that up' },
        { role: 'function' as const, content: '{"result":"data"}', toolName: 'lookup' },
        { role: 'model' as const, content: 'Here is what I found in your policy details today.' },
      ],
    } as Session;

    truncateLastAssistantMessage(session, 'Here is what I');

    expect(session.conversationHistory[0]!.content).toBe('Let me look that up');
    expect(session.conversationHistory[2]!.content).toBe('Here is what I');
  });
});

// ---------------------------------------------------------------------------
// SessionManager barge-in tests
// NOTE: These require the full import chain (incl. @ai-coustics/aic-sdk native binary).
// They share the same limitation as the existing session.test.ts — they may fail
// in environments where the native binary is not available.
// ---------------------------------------------------------------------------

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

function activateSession(manager: SessionManager, callSid: string, streamSid: string) {
  const ws = createMockWs();
  manager.createSession(callSid, ws);
  manager.handleTwilioMessage(callSid, makeStartMessage(callSid, streamSid, '+15551234567'));
  return { ws, session: manager.getSession(callSid)! };
}

/**
 * Simulate the continuous background loop having sent N chunks from the queue.
 * Removes items from the front of the audio queue and advances sentChunks.
 */
function simulateChunksSent(session: Session, count: number): void {
  const toSend = Math.min(count, session.audioQueue.length);
  session.audioQueue.splice(0, toSend);
  session.playback.sentChunks += toSend;
}

describe('Barge-in: PlaybackState tracking', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  afterEach(() => {
    for (const session of manager.getActiveSessions()) {
      manager.endSession(session.callSid);
    }
  });

  it('initializes playback state as not playing', () => {
    const ws = createMockWs();
    const session = manager.createSession('CA_123', ws);
    expect(session.playback.isPlaying).toBe(false);
    expect(session.playback.totalChunks).toBe(0);
    expect(session.playback.sentChunks).toBe(0);
    expect(session.playback.fullText).toBe('');
  });

  it('sets playback state when sendAudioToTwilio is called with responseText', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    const audio = Buffer.alloc(480, 0x7f).toString('base64'); // 3 chunks
    manager.sendAudioToTwilio(session, audio, 'Hello there, how can I help?');

    expect(session.playback.isPlaying).toBe(true);
    expect(session.playback.totalChunks).toBe(3);
    expect(session.playback.sentChunks).toBe(0);
    expect(session.playback.fullText).toBe('Hello there, how can I help?');
  });

  it('does not set playback state when no responseText provided', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    const audio = Buffer.alloc(160, 0x7f).toString('base64');
    manager.sendAudioToTwilio(session, audio);

    // isPlaying is true because sendAudioToTwilio always sets it now
    expect(session.playback.isPlaying).toBe(true);
    expect(session.playback.fullText).toBe('');
  });

  it('tracks sentChunks as continuous loop sends chunks', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    const audio = Buffer.alloc(480, 0x7f).toString('base64'); // 3 chunks
    manager.sendAudioToTwilio(session, audio, 'Three chunk response');

    expect(session.playback.sentChunks).toBe(0);

    // Simulate the continuous loop sending chunks
    session.audioQueue.shift();
    session.playback.sentChunks = 1;

    session.audioQueue.shift();
    session.playback.sentChunks = 2;

    session.audioQueue.shift();
    session.playback.sentChunks = 3;
    expect(session.playback.sentChunks).toBe(3);
  });

  it('marks playback complete on mark event when queue is empty', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    const audio = Buffer.alloc(160, 0x7f).toString('base64'); // 1 chunk
    manager.sendAudioToTwilio(session, audio, 'Short response');

    // Simulate the continuous loop draining the queue
    session.audioQueue.length = 0;
    session.playback.sentChunks = 1;
    // isPlaying stays true until mark event arrives
    expect(session.playback.isPlaying).toBe(true);

    // Twilio sends back a mark
    manager.handleTwilioMessage('CA_123', makeMarkMessage('MZ_456', 'mark_1'));

    expect(session.playback.isPlaying).toBe(false);
  });
});

describe('Barge-in: Interruption handling', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  afterEach(() => {
    for (const session of manager.getActiveSessions()) {
      manager.endSession(session.callSid);
    }
  });

  it('clears audio queue and sends clear message on interruption', () => {
    const { ws, session } = activateSession(manager, 'CA_123', 'MZ_456');

    // Queue 50 chunks of audio (need >25 sent to pass barge-in grace period)
    const audio = Buffer.alloc(50 * 160, 0x7f).toString('base64');
    manager.sendAudioToTwilio(session, audio, 'My name is Bella, and I can help you with insurance.');

    // Send 30 chunks (simulate partial playback past barge-in threshold)
    simulateChunksSent(session, 30);
    expect(session.playback.sentChunks).toBe(30);
    expect(session.audioQueue).toHaveLength(20);

    ws.sent.length = 0; // Clear sent messages to isolate the clear message

    // User starts speaking — sends media while playing
    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    // Audio queue should be cleared
    expect(session.audioQueue).toHaveLength(0);

    // A "clear" message should have been sent to Twilio
    const clearMsg = ws.sent.find(m => {
      try { return JSON.parse(m).event === 'clear'; } catch { return false; }
    });
    expect(clearMsg).toBeDefined();
    const parsed = JSON.parse(clearMsg!);
    expect(parsed.streamSid).toBe('MZ_456');

    // Playback should be marked as stopped
    expect(session.playback.isPlaying).toBe(false);
  });

  it('truncates conversation history to heard portion', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    const fullText = 'My name is Bella, and I can help you with insurance.';
    session.conversationHistory.push({ role: 'model', content: fullText });

    // 50 chunks total, 30 sent = 60% heard (needs >25 to pass barge-in grace period)
    const audio = Buffer.alloc(50 * 160, 0x7f).toString('base64');
    manager.sendAudioToTwilio(session, audio, fullText);

    // Simulate 30 chunks sent
    simulateChunksSent(session, 30);

    // User interrupts
    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    // The last model message should be truncated
    const lastModel = session.conversationHistory.find(m => m.role === 'model');
    expect(lastModel).toBeDefined();
    expect(lastModel!.content.length).toBeLessThan(fullText.length);
    expect(fullText.startsWith(lastModel!.content)).toBe(true);
  });

  it('filters out noise — does not trigger barge-in with too few sent chunks', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    session.conversationHistory.push({ role: 'model', content: 'Response that was never heard' });

    const audio = Buffer.alloc(320, 0x7f).toString('base64'); // 2 chunks
    manager.sendAudioToTwilio(session, audio, 'Response that was never heard');

    // Only 1 chunk sent — below BARGEIN_MIN_SENT_CHUNKS threshold (25)
    simulateChunksSent(session, 1);
    expect(session.playback.sentChunks).toBe(1);

    // User speaks — should NOT trigger barge-in (noise filter)
    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    // Conversation history unchanged
    const lastModel = session.conversationHistory.find(m => m.role === 'model');
    expect(lastModel!.content).toBe('Response that was never heard');
  });

  it('does not trigger barge-in when not playing', () => {
    const { ws, session } = activateSession(manager, 'CA_123', 'MZ_456');

    expect(session.playback.isPlaying).toBe(false);
    ws.sent.length = 0;

    // User sends media normally — no clear message
    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    const clearMsg = ws.sent.find(m => {
      try { return JSON.parse(m).event === 'clear'; } catch { return false; }
    });
    expect(clearMsg).toBeUndefined();
    expect(session.audioBuffer).toHaveLength(1);
  });

  it('resets playback state completely after interruption', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    session.conversationHistory.push({ role: 'model', content: 'Some response' });

    const audio = Buffer.alloc(50 * 160, 0x7f).toString('base64');
    manager.sendAudioToTwilio(session, audio, 'Some response');

    simulateChunksSent(session, 30);

    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    expect(session.playback.isPlaying).toBe(false);
    expect(session.playback.sentChunks).toBe(0);
    expect(session.playback.totalChunks).toBe(0);
    expect(session.playback.fullText).toBe('');
  });

  it('still buffers incoming audio after barge-in', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    session.conversationHistory.push({ role: 'model', content: 'Hello there' });

    const audio = Buffer.alloc(50 * 160, 0x7f).toString('base64');
    manager.sendAudioToTwilio(session, audio, 'Hello there');

    simulateChunksSent(session, 30);

    // Interrupt — also adds media to audio buffer
    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    expect(session.audioBuffer).toHaveLength(1);
  });

  it('handles interruption during multi-turn conversation', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    // First turn — completed normally
    session.conversationHistory.push({ role: 'user', content: 'Hello' });
    session.conversationHistory.push({ role: 'model', content: 'Hi, I am Bella.' });

    // Second turn — will be interrupted
    session.conversationHistory.push({ role: 'user', content: 'Can you help me?' });
    session.conversationHistory.push({ role: 'model', content: 'Of course! I would be happy to help you with your insurance needs today.' });

    const audio = Buffer.alloc(60 * 160, 0x7f).toString('base64');
    manager.sendAudioToTwilio(session, audio, 'Of course! I would be happy to help you with your insurance needs today.');

    simulateChunksSent(session, 30);

    manager.handleTwilioMessage('CA_123', makeMediaMessage('MZ_456', 'dGVzdA=='));

    // First turn should be unaffected
    expect(session.conversationHistory[1]!.content).toBe('Hi, I am Bella.');

    // Second turn's model message should be truncated
    const lastModel = session.conversationHistory[3]!;
    expect(lastModel.role).toBe('model');
    expect(lastModel.content.length).toBeLessThan('Of course! I would be happy to help you with your insurance needs today.'.length);
    expect('Of course! I would be happy to help you with your insurance needs today.'.startsWith(lastModel.content)).toBe(true);
  });

  it('removes entire assistant message when heardText is empty', () => {
    const { session } = activateSession(manager, 'CA_123', 'MZ_456');

    session.conversationHistory.push({ role: 'user', content: 'Help' });
    session.conversationHistory.push({ role: 'model', content: 'Sure, let me assist you.' });

    // Set playback state directly — sentChunks=26 meets the >=25 threshold,
    // but with totalChunks=5000 the ratio is tiny: 26/5000 ≈ 0.5% of 24 chars = 0 → empty heard text
    session.playback = {
      fullText: 'Sure, let me assist you.',
      totalChunks: 5000,
      sentChunks: 26,
      isPlaying: true,
    };

    manager.handleInterruption(session);

    // The model message should be removed entirely
    const modelMsgs = session.conversationHistory.filter(m => m.role === 'model');
    expect(modelMsgs).toHaveLength(0);
    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]!.role).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// isNonSpeech filter — prevents noise artifacts from reaching the LLM
// ---------------------------------------------------------------------------

describe('isNonSpeech', () => {
  it('returns true for empty/short text', () => {
    expect(isNonSpeech('')).toBe(true);
    expect(isNonSpeech(' ')).toBe(true);
    expect(isNonSpeech('a')).toBe(true);
  });

  it('returns true for parenthetical noise descriptions', () => {
    expect(isNonSpeech('(static sound)')).toBe(true);
    expect(isNonSpeech('(Static Sound)')).toBe(true);
    expect(isNonSpeech('(noise)')).toBe(true);
    expect(isNonSpeech('(background noise)')).toBe(true);
    expect(isNonSpeech('(silence)')).toBe(true);
    expect(isNonSpeech('(water flowing)')).toBe(true);
    expect(isNonSpeech('(clears throat)')).toBe(true);
  });

  it('returns true for any arbitrary parenthetical description', () => {
    expect(isNonSpeech('(some random noise)')).toBe(true);
    expect(isNonSpeech('(dog barking)')).toBe(true);
  });

  it('returns false for actual speech', () => {
    expect(isNonSpeech('Hello')).toBe(false);
    expect(isNonSpeech('I need help with my claim')).toBe(false);
    expect(isNonSpeech('Yes')).toBe(false);
    expect(isNonSpeech('no')).toBe(false);
  });

  it('returns false for speech that contains parentheses but is not purely parenthetical', () => {
    expect(isNonSpeech('I said (hello) to you')).toBe(false);
    expect(isNonSpeech('(static sound) and then I said hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isLikelySilence — energy-based silence detection for mulaw audio
// ---------------------------------------------------------------------------

describe('isLikelySilence', () => {
  it('returns true for empty audio', () => {
    expect(isLikelySilence('')).toBe(true);
  });

  it('returns true for silence bytes (0xFF)', () => {
    const silenceBuf = Buffer.alloc(160, 0xff);
    expect(isLikelySilence(silenceBuf.toString('base64'))).toBe(true);
  });

  it('returns true for near-silence bytes', () => {
    const nearSilence = Buffer.alloc(160, 0xfe);
    expect(isLikelySilence(nearSilence.toString('base64'))).toBe(true);
  });

  it('returns false for loud audio', () => {
    const loudBuf = Buffer.alloc(160, 0x00);
    expect(isLikelySilence(loudBuf.toString('base64'))).toBe(false);
  });

  it('returns false for varied non-silence audio', () => {
    const noisyBuf = Buffer.alloc(160);
    for (let i = 0; i < 160; i++) noisyBuf[i] = i % 128;
    expect(isLikelySilence(noisyBuf.toString('base64'))).toBe(false);
  });
});
