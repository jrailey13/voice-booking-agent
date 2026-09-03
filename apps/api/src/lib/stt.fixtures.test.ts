import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decodeToPcm16kMono } from './audio';
import { transcribe } from './stt';

// Opt-in regression: replays real captured microphone clips through the full
// decode → Whisper path and asserts each still transcribes to the text it
// produced when captured. It locks STT behaviour against model/pipeline drift.
//
// It is OFF by default because it loads the Whisper model (slow, needs the
// model cached) and depends on local fixtures that are git-ignored (they hold
// real voice/PII). Capture some with CAPTURE_AUDIO=1 on the API, then run:
//   RUN_STT_FIXTURES=1 npx vitest run src/lib/stt.fixtures.test.ts
//
// Note: the sidecar .txt is whatever Whisper heard at capture time, so this is
// a drift lock, not a correctness check — a clip may still be mis-heard (that's
// exactly why booking supports later corrections).
const RUN = process.env.RUN_STT_FIXTURES === '1';
const FIXTURE_DIR = join(process.cwd(), 'test', 'fixtures', 'audio');

function listFixtures(): string[] {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.webm'))
    .sort();
}

const fixtures = RUN ? listFixtures() : [];

describe('STT fixture regression (opt-in via RUN_STT_FIXTURES=1)', () => {
  if (!RUN) {
    it.skip('set RUN_STT_FIXTURES=1 to replay captured audio through Whisper', () => {});
    return;
  }
  if (fixtures.length === 0) {
    it.skip('no fixtures found — record some with CAPTURE_AUDIO=1 on the API', () => {});
    return;
  }

  it.each(fixtures)(
    'transcribes %s to its captured transcript',
    async (webm) => {
      const expected = readFileSync(
        join(FIXTURE_DIR, webm.replace(/\.webm$/, '.txt')),
        'utf8'
      ).trim();
      const audio = readFileSync(join(FIXTURE_DIR, webm));
      const pcm = await decodeToPcm16kMono(audio);
      const actual = (await transcribe(pcm)).trim();
      expect(actual).toBe(expected);
    },
    60000 // model load + ffmpeg decode + inference
  );
});
