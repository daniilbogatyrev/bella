import { mock } from 'bun:test';

// Disable background noise mixing in tests to avoid WAV processing overhead
process.env.BG_NOISE_ENABLED = 'false';

mock.module('@ai-coustics/aic-sdk', () => ({
  Model: class Model {
    static async init() { return new Model(); }
  },
  Processor: class Processor {
    constructor() {}
    async init() {}
    getOptimalNumFrames() { return 1024; }
    async process() { return new Float32Array(0); }
  },
  ProcessorParameter: {},
}));
