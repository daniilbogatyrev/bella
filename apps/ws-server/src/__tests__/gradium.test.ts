import { describe, it, expect, beforeEach } from 'bun:test';
import { GradiumClient, getGradiumClient, resetGradiumClient } from '../gradium';

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
