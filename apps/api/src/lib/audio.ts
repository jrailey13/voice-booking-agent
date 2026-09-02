import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import ffmpegPath from 'ffmpeg-static';

const TARGET_SAMPLE_RATE = 16000;

/**
 * Decode arbitrary browser audio (webm/opus, wav, …) into the mono 16 kHz
 * Float32 PCM that the Whisper model expects. Uses the bundled ffmpeg-static
 * binary, so there is nothing to install on the host.
 */
export async function decodeToPcm16kMono(input: Buffer): Promise<Float32Array> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found');
  }
  // ffmpeg needs a seekable input for webm/matroska, so write to a temp file
  // rather than piping the container in on stdin.
  const tmpFile = join(tmpdir(), `stt-${randomUUID()}`);
  await writeFile(tmpFile, input);
  try {
    const raw = await runFfmpeg(ffmpegPath, tmpFile);
    return toFloat32(raw);
  } finally {
    unlink(tmpFile).catch(() => {});
  }
}

function runFfmpeg(bin: string, inputPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-f', 'f32le',            // raw 32-bit float little-endian
      '-ac', '1',               // mono
      '-ar', String(TARGET_SAMPLE_RATE),
      'pipe:1',
      '-hide_banner',
      '-loglevel', 'error',
    ];
    const proc = spawn(bin, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (c) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(err).toString()}`));
    });
  });
}

/** Reinterpret a little-endian f32 byte buffer as Float32 samples (alignment-safe). */
function toFloat32(buf: Buffer): Float32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const samples = new Float32Array(Math.floor(buf.byteLength / 4));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getFloat32(i * 4, true);
  }
  return samples;
}
