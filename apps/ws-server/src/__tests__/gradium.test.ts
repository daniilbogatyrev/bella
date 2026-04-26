import { describe, it, expect, beforeEach } from 'bun:test';
import { GradiumClient, GradiumTTSStream, getGradiumClient, resetGradiumClient, createTTSStream } from '../gradium';

describe('GradiumClient', () => {
  describe('class', () => {
    it('exists and can be instantiated with config', () => {
      const client = new GradiumClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.gradium.ai',
      });
      expect(client).toBeInstanceOf(GradiumClient);
    });

    it('accepts optional sttModel, ttsModel, ttsVoice', () => {
      const client = new GradiumClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.gradium.ai',
        sttModel: 'custom-stt',
        ttsModel: 'custom-tts',
        ttsVoice: 'echo',
      });
      expect(client).toBeInstanceOf(GradiumClient);
    });

    it('has speechToText method', () => {
      const client = new GradiumClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.gradium.ai',
      });
      expect(typeof client.speechToText).toBe('function');
    });

    it('has textToSpeech method', () => {
      const client = new GradiumClient({
        apiKey: 'test-key',
        baseUrl: 'https://api.gradium.ai',
      });
      expect(typeof client.textToSpeech).toBe('function');
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      resetGradiumClient();
      delete process.env.GRADIUM_API_KEY;
      delete process.env.GRADIUM_BASE_URL;
    });

    it('throws when GRADIUM_API_KEY is not set', () => {
      expect(() => getGradiumClient()).toThrow('GRADIUM_API_KEY is required');
    });

    it('returns a GradiumClient when API key is set', () => {
      process.env.GRADIUM_API_KEY = 'test-key';
      const client = getGradiumClient();
      expect(client).toBeInstanceOf(GradiumClient);
    });

    it('returns the same instance on subsequent calls', () => {
      process.env.GRADIUM_API_KEY = 'test-key';
      const client1 = getGradiumClient();
      const client2 = getGradiumClient();
      expect(client1).toBe(client2);
    });

    it('uses GRADIUM_BASE_URL from env if set', () => {
      process.env.GRADIUM_API_KEY = 'test-key';
      process.env.GRADIUM_BASE_URL = 'https://custom.gradium.ai';
      const client = getGradiumClient();
      expect(client).toBeInstanceOf(GradiumClient);
    });

    it('returns fresh instance after reset', () => {
      process.env.GRADIUM_API_KEY = 'test-key';
      const client1 = getGradiumClient();
      resetGradiumClient();
      const client2 = getGradiumClient();
      expect(client1).not.toBe(client2);
    });
  });
});

describe('GradiumTTSStream', () => {
  it('can be instantiated with config', () => {
    const stream = new GradiumTTSStream({
      apiKey: 'test-key',
      baseUrl: 'https://api.gradium.ai',
    });
    expect(stream).toBeInstanceOf(GradiumTTSStream);
    expect(stream.isConnected).toBe(false);
  });

  it('has synthesize, connect, and close methods', () => {
    const stream = new GradiumTTSStream({
      apiKey: 'test-key',
      baseUrl: 'https://api.gradium.ai',
    });
    expect(typeof stream.connect).toBe('function');
    expect(typeof stream.synthesize).toBe('function');
    expect(typeof stream.close).toBe('function');
  });

  it('connect() rejects without apiKey', async () => {
    const stream = new GradiumTTSStream({
      apiKey: '',
      baseUrl: 'https://api.gradium.ai',
    });
    expect(stream.connect()).rejects.toThrow('apiKey is required');
  });

  it('isConnected is false before connect()', () => {
    const stream = new GradiumTTSStream({
      apiKey: 'test-key',
      baseUrl: 'https://api.gradium.ai',
    });
    expect(stream.isConnected).toBe(false);
  });

  it('rejects synthesize when closed', async () => {
    const stream = new GradiumTTSStream({
      apiKey: 'test-key',
      baseUrl: 'https://api.gradium.ai',
    });
    stream.close();
    expect(stream.synthesize('hello')).rejects.toThrow('stream is closed');
  });

  it('close() is safe to call multiple times', () => {
    const stream = new GradiumTTSStream({
      apiKey: 'test-key',
      baseUrl: 'https://api.gradium.ai',
    });
    stream.close();
    stream.close();
    expect(stream.isConnected).toBe(false);
  });

  describe('createTTSStream factory', () => {
    beforeEach(() => {
      delete process.env.GRADIUM_API_KEY;
      delete process.env.GRADIUM_BASE_URL;
    });

    it('throws when GRADIUM_API_KEY is not set', () => {
      expect(() => createTTSStream()).toThrow('GRADIUM_API_KEY is required');
    });

    it('returns a GradiumTTSStream when API key is set', () => {
      process.env.GRADIUM_API_KEY = 'test-key';
      const stream = createTTSStream();
      expect(stream).toBeInstanceOf(GradiumTTSStream);
      stream.close();
    });
  });
});
