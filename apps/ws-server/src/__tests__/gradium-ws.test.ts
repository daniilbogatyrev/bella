/**
 * Integration test: verifies Gradium WebSocket STT and TTS connections
 * authenticate via x-api-key header and handle JSON+base64 audio format.
 */
import { describe, test, expect } from 'bun:test';

const API_KEY = process.env.GRADIUM_API_KEY || 'gsk_c14b07c9ed76da1625dc9efee598397f030b6fc3df59c8a45ec8ff9c304e15d9';
const BASE_URL = 'wss://api.gradium.ai';

function openWs(path: string): WebSocket {
  return new WebSocket(`${BASE_URL}${path}`, {
    headers: { 'x-api-key': API_KEY },
  } as any);
}

describe('Gradium WebSocket (live)', () => {
  test('STT: authenticates, sends JSON+base64 audio frames, receives end_of_stream', async () => {
    const result = await new Promise<{ gotReady: boolean; gotStep: boolean; gotEos: boolean; error?: string }>((resolve) => {
      let gotReady = false;
      let gotStep = false;
      let gotEos = false;
      const timer = setTimeout(() => resolve({ gotReady, gotStep, gotEos, error: 'timeout after 15s' }), 15_000);
      const ws = openWs('/api/speech/asr');

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'setup', model_name: 'default', input_format: 'pcm' }));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));

          if (msg.type === 'ready') {
            gotReady = true;
            for (let i = 0; i < 5; i++) {
              const silence = Buffer.alloc(3840);
              ws.send(JSON.stringify({ type: 'audio', audio: silence.toString('base64') }));
            }
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          } else if (msg.type === 'step') {
            gotStep = true;
          } else if (msg.type === 'end_of_stream') {
            gotEos = true;
            clearTimeout(timer);
            ws.close();
            resolve({ gotReady, gotStep, gotEos });
          } else if (msg.type === 'error') {
            clearTimeout(timer);
            ws.close();
            resolve({ gotReady, gotStep, gotEos, error: `server error: ${msg.message} (code ${msg.code})` });
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timer); resolve({ gotReady, gotStep, gotEos, error: 'connection error' }); };
      ws.onclose = (ev: CloseEvent) => {
        clearTimeout(timer);
        if (!gotEos) resolve({ gotReady, gotStep, gotEos, error: `closed early code=${ev.code}` });
      };
    });

    console.log('STT result:', result);
    expect(result.error).toBeUndefined();
    expect(result.gotReady).toBe(true);
    expect(result.gotStep).toBe(true);
    expect(result.gotEos).toBe(true);
  }, 20_000);

  test('TTS: authenticates, sends text, receives audio chunks + end_of_stream', async () => {
    const result = await new Promise<{ ready: boolean; audioChunks: number; gotEos: boolean; error?: string }>((resolve) => {
      let audioChunks = 0;
      let gotEos = false;
      const timer = setTimeout(() => resolve({ ready: false, audioChunks, gotEos, error: 'timeout after 15s' }), 15_000);
      const ws = openWs('/api/speech/tts');

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'setup', voice_id: 'YTpq7expH9539ERJ', model_name: 'default', output_format: 'ulaw_8000' }));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));

          if (msg.type === 'ready') {
            ws.send(JSON.stringify({ type: 'text', text: 'Hello' }));
            ws.send(JSON.stringify({ type: 'end_of_stream' }));
          } else if (msg.type === 'audio' && msg.audio) {
            audioChunks++;
          } else if (msg.type === 'end_of_stream') {
            gotEos = true;
            clearTimeout(timer);
            ws.close();
            resolve({ ready: true, audioChunks, gotEos });
          } else if (msg.type === 'error') {
            clearTimeout(timer);
            ws.close();
            resolve({ ready: false, audioChunks, gotEos, error: `server error: ${msg.message} (code ${msg.code})` });
          }
        } catch {}
      };

      ws.onerror = () => { clearTimeout(timer); resolve({ ready: false, audioChunks, gotEos, error: 'connection error' }); };
      ws.onclose = (ev: CloseEvent) => {
        clearTimeout(timer);
        if (!gotEos) resolve({ ready: false, audioChunks, gotEos, error: `closed early code=${ev.code}` });
      };
    });

    console.log('TTS result:', result);
    expect(result.ready).toBe(true);
    expect(result.audioChunks).toBeGreaterThan(0);
    expect(result.gotEos).toBe(true);
  }, 20_000);
});
