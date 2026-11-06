export type SampleBuffer = Float32Array | Float64Array | readonly number[];

export interface SilenceOptions {
  sampleRate: number;
  /** Samples per non-overlapping analysis block (the final block may be shorter). */
  blockSize: number;
  /** A block with RMS below this dBFS value is silent (when not already silent). */
  thresholdDb: number;
  /** A silent run only ends at a block with RMS >= thresholdDb + hysteresisDb. Default 0. */
  hysteresisDb?: number;
  /** Minimum duration of a final (padded) silent range in seconds. Default 0. */
  minSilenceSeconds?: number;
  /** Seconds of audio kept as sound on each interior side of a silent range. Default 0. */
  paddingSeconds?: number;
  /** Level reported for zero RMS (and lower values). Default -120. */
  floorDb?: number;
  maxSamples?: number;
}

export interface SampleRange {
  startSample: number;
  endSample: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface SilenceAnalysis {
  totalSamples: number;
  blockSize: number;
  blockDb: Float64Array;
  /** 1 for blocks in a silent run before minimum-duration and padding rules, else 0. */
  blockSilent: Uint8Array;
  silences: SampleRange[];
  sounds: SampleRange[];
}

export const DEFAULT_MAX_SAMPLES = 67_108_864;

function assertSamples(input: unknown, maxSamples: number): asserts input is SampleBuffer {
  if (!(input instanceof Float32Array || input instanceof Float64Array || Array.isArray(input))) {
    throw new TypeError('samples must be a Float32Array, Float64Array or number array');
  }
  const values = input as ArrayLike<unknown>;
  if (values.length > maxSamples) throw new RangeError('samples exceed maxSamples');
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`samples[${i}] must be a finite number`);
    }
  }
}

function finite(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number from ${min} to ${max}`);
  }
  return value;
}

/** RMS level in dBFS for each block, clamped below at floorDb. Full scale sine-free: a constant 1.0 is 0 dB. */
export function blockLevelsDb(
  samples: SampleBuffer,
  blockSize: number,
  floorDb = -120,
): Float64Array {
  assertSamples(samples, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(blockSize) || blockSize < 1)
    throw new RangeError('blockSize must be a positive integer');
  finite('floorDb', floorDb, -1000, 0);
  const blocks = Math.ceil(samples.length / blockSize);
  const levels = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    const from = b * blockSize;
    const to = Math.min(samples.length, from + blockSize);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / (to - from));
    levels[b] = rms === 0 ? floorDb : Math.max(floorDb, 20 * Math.log10(rms));
  }
  return levels;
}

/** Deterministic block-RMS threshold analysis with a hysteresis state machine. No inference or ML. */
export function analyzeSilence(samples: SampleBuffer, options: SilenceOptions): SilenceAnalysis {
  if (typeof options !== 'object' || options === null)
    throw new TypeError('options must be an object');
  const maxSamples = options.maxSamples === undefined ? DEFAULT_MAX_SAMPLES : options.maxSamples;
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 0)
    throw new RangeError('maxSamples must be a non-negative integer');
  assertSamples(samples, maxSamples);
  const rate = finite('sampleRate', options.sampleRate, Number.MIN_VALUE, 1e9);
  const blockSize = options.blockSize;
  if (!Number.isSafeInteger(blockSize) || blockSize < 1)
    throw new RangeError('blockSize must be a positive integer');
  const threshold = finite('thresholdDb', options.thresholdDb, -1000, 0);
  const hysteresis = finite('hysteresisDb', options.hysteresisDb ?? 0, 0, 1000);
  const minSamples = Math.round(
    finite('minSilenceSeconds', options.minSilenceSeconds ?? 0, 0, 1e9) * rate,
  );
  const padSamples = Math.round(
    finite('paddingSeconds', options.paddingSeconds ?? 0, 0, 1e9) * rate,
  );
  const floorDb = finite('floorDb', options.floorDb ?? -120, -1000, 0);
  const total = samples.length;
  const blockDb = blockLevelsDb(samples, blockSize, floorDb);
  const blockSilent = new Uint8Array(blockDb.length);
  let silent = false;
  for (let b = 0; b < blockDb.length; b++) {
    const level = blockDb[b]!;
    silent = silent ? level < threshold + hysteresis : level < threshold;
    blockSilent[b] = silent ? 1 : 0;
  }
  const toRange = (start: number, end: number): SampleRange => ({
    startSample: start,
    endSample: end,
    startSeconds: start / rate,
    endSeconds: end / rate,
    durationSeconds: (end - start) / rate,
  });
  const silences: SampleRange[] = [];
  for (let b = 0; b < blockSilent.length;) {
    if (!blockSilent[b]) {
      b++;
      continue;
    }
    let e = b;
    while (e < blockSilent.length && blockSilent[e]) e++;
    let start = b * blockSize;
    let end = Math.min(total, e * blockSize);
    if (start > 0) start += padSamples;
    if (end < total) end -= padSamples;
    if (end - start > 0 && end - start >= minSamples) silences.push(toRange(start, end));
    b = e;
  }
  const sounds: SampleRange[] = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.startSample > cursor) sounds.push(toRange(cursor, silence.startSample));
    cursor = silence.endSample;
  }
  if (cursor < total) sounds.push(toRange(cursor, total));
  return { totalSamples: total, blockSize, blockDb, blockSilent, silences, sounds };
}
