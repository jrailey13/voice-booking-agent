import { pipeline } from '@huggingface/transformers';

// Local, free speech-to-text via transformers.js (ONNX Whisper) running
// in-process. The model is downloaded once from the HF Hub and cached; no API
// key, no per-request cost, and audio never leaves the machine.
const MODEL = process.env.WHISPER_MODEL || 'Xenova/whisper-base.en';

// Loading the model is expensive, so build the pipeline once and reuse it.
// A shared promise also coalesces concurrent first-calls onto one load.
let asrPromise: Promise<any> | null = null;

function getPipeline(): Promise<any> {
  if (!asrPromise) {
    console.log(`🗣️  Loading local STT model: ${MODEL} (first run downloads it)`);
    asrPromise = pipeline('automatic-speech-recognition', MODEL);
  }
  return asrPromise;
}

/**
 * Transcribe mono 16 kHz Float32 PCM to text using the local Whisper model.
 */
export async function transcribe(pcm: Float32Array): Promise<string> {
  const asr = await getPipeline();
  const output = await asr(pcm);
  const text = Array.isArray(output)
    ? output.map((o) => o.text).join(' ')
    : output?.text;
  return (text || '').trim();
}

/** Eagerly load the model (e.g. to warm it at startup). Safe to call repeatedly. */
export async function warmUpStt(): Promise<void> {
  await getPipeline();
}
