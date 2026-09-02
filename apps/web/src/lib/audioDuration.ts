/**
 * Whole seconds of audio between two wall-clock timestamps (ms), clamped to a
 * 1-second minimum so a near-instant clip still registers as billable time.
 *
 * This replaces the earlier `blob.size / (44100 * 2)` estimate, which applied a
 * raw-PCM formula to a compressed Opus blob and therefore over-reported
 * duration (and Whisper cost) by roughly the codec's compression ratio.
 * Measuring elapsed record time is codec-independent and accurate.
 */
export function elapsedSeconds(startMs: number, endMs: number): number {
  return Math.max(1, Math.round((endMs - startMs) / 1000));
}
