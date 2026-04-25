declare module '@ai-coustics/aic-sdk' {
  export class Model {
    static fromFile(path: string): Model;
    static download(modelId: string, downloadDir: string): string;
    getId(): string;
    getOptimalSampleRate(): number;
    getOptimalNumFrames(sampleRate: number): number;
  }

  export class Processor {
    constructor(model: Model, licenseKey: string);
    initialize(
      sampleRate: number,
      numChannels: number,
      numFrames: number,
      allowVariableFrames?: boolean,
    ): void;
    processInterleaved(buffer: Float32Array): void;
    processSequential(buffer: Float32Array): void;
    processPlanar(buffers: Float32Array[]): void;
    getProcessorContext(): ProcessorContext;
    getVadContext(): VadContext;
  }

  export class ProcessorContext {
    reset(): void;
    setParameter(parameter: number, value: number): void;
    getParameter(parameter: number): number;
    getOutputDelay(): number;
  }

  export class VadContext {
    isSpeechDetected(): boolean;
    setParameter(parameter: number, value: number): void;
    getParameter(parameter: number): number;
  }

  export const ProcessorParameter: {
    readonly Bypass: number;
    readonly EnhancementLevel: number;
  };

  export const VadParameter: {
    readonly SpeechHoldDuration: number;
    readonly Sensitivity: number;
    readonly MinimumSpeechDuration: number;
  };

  export function getVersion(): string;
  export function getCompatibleModelVersion(): number;
}
