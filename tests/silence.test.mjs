import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSilence, blockLevelsDb } from '../dist/esm/index.js';

const base = { sampleRate: 1000, blockSize: 10, thresholdDb: -40 };
function build(spec) {
  const out = [];
  for (const [n, amp] of spec) for (let i = 0; i < n; i++) out.push(i % 2 ? -amp : amp);
  return out;
}

function reference(x, o) {
  const hyst = o.hysteresisDb ?? 0;
  const pad = Math.round((o.paddingSeconds ?? 0) * o.sampleRate);
  const min = Math.round((o.minSilenceSeconds ?? 0) * o.sampleRate);
  const flags = [];
  let silent = false;
  for (let s = 0; s < x.length; s += o.blockSize) {
    const block = x.slice(s, s + o.blockSize);
    const rms = Math.sqrt(block.reduce((a, v) => a + v * v, 0) / block.length);
    const db = rms === 0 ? -120 : Math.max(-120, 20 * Math.log10(rms));
    silent = silent ? db < o.thresholdDb + hyst : db < o.thresholdDb;
    for (let i = 0; i < block.length; i++) flags.push(silent);
  }
  const ranges = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    let j = i;
    while (j < flags.length && flags[j]) j++;
    let a = i;
    let b = j;
    if (a > 0) a += pad;
    if (b < flags.length) b -= pad;
    if (b - a > 0 && b - a >= min) ranges.push([a, b]);
    i = j;
  }
  return ranges;
}
const pairs = (analysis) => analysis.silences.map((r) => [r.startSample, r.endSample]);

test('rejects malformed samples and options', () => {
  assert.throws(() => analyzeSilence('x', base), TypeError);
  assert.throws(() => analyzeSilence(new Int16Array(4), base), TypeError);
  assert.throws(() => analyzeSilence([0, Number.NaN], base), RangeError);
  assert.throws(() => analyzeSilence(new Float32Array([Infinity]), base), RangeError);
  assert.throws(() => analyzeSilence([0], null), TypeError);
  for (const bad of [
    { sampleRate: 0 },
    { sampleRate: Number.NaN },
    { blockSize: 0 },
    { blockSize: 1.5 },
    { thresholdDb: 3 },
    { thresholdDb: Number.NaN },
    { hysteresisDb: -1 },
    { minSilenceSeconds: -1 },
    { paddingSeconds: Infinity },
    { floorDb: 5 },
    { maxSamples: -1 },
  ]) {
    assert.throws(() => analyzeSilence([0, 0], { ...base, ...bad }), RangeError);
  }
  assert.throws(() => analyzeSilence([0, 0, 0], { ...base, maxSamples: 2 }), RangeError);
  assert.throws(() => blockLevelsDb([0], 0), RangeError);
});

test('block levels are exact RMS dBFS with a floor', () => {
  const levels = blockLevelsDb([1, 1, 0.5, 0.5, 0, 0, 0.1], 2);
  assert.equal(levels.length, 4);
  assert.ok(Math.abs(levels[0]) < 1e-12);
  assert.ok(Math.abs(levels[1] - 20 * Math.log10(0.5)) < 1e-12);
  assert.equal(levels[2], -120);
  assert.ok(Math.abs(levels[3] - -20) < 1e-12);
  assert.equal(blockLevelsDb([0], 1, -90)[0], -90);
});

test('detects silent runs and complementary sound ranges', () => {
  const x = build([
    [50, 0.5],
    [100, 0],
    [50, 0.5],
  ]);
  const result = analyzeSilence(x, base);
  assert.deepEqual(pairs(result), [[50, 150]]);
  assert.deepEqual(
    result.sounds.map((r) => [r.startSample, r.endSample]),
    [
      [0, 50],
      [150, 200],
    ],
  );
  assert.equal(result.silences[0].durationSeconds, 0.1);
  assert.equal(result.silences[0].startSeconds, 0.05);
  assert.equal(result.blockSilent.length, 20);
  assert.equal(analyzeSilence([], base).silences.length, 0);
});

test('matches independent per-sample reference across option grids', () => {
  let seed = 7;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const spec = Array.from({ length: 12 }, () => [
    10 + Math.floor(rand() * 40),
    rand() < 0.5 ? 0.0004 * rand() : 0.05 + rand() * 0.5,
  ]);
  const x = build(spec);
  for (const hysteresisDb of [0, 6, 20]) {
    for (const minSilenceSeconds of [0, 0.03, 0.08]) {
      for (const paddingSeconds of [0, 0.01, 0.025]) {
        const o = {
          ...base,
          thresholdDb: -45,
          hysteresisDb,
          minSilenceSeconds,
          paddingSeconds,
          blockSize: 7,
        };
        assert.deepEqual(pairs(analyzeSilence(x, o)), reference(x, o));
      }
    }
  }
});

test('hysteresis prevents chattering around the threshold', () => {
  const noisy = build([
    [10, 0.001],
    [10, 0.0034],
    [10, 0.001],
  ]);
  const options = { ...base, thresholdDb: -50 };
  assert.deepEqual(pairs(analyzeSilence(noisy, options)), [
    [0, 10],
    [20, 30],
  ]);
  assert.deepEqual(pairs(analyzeSilence(noisy, { ...options, hysteresisDb: 6 })), [[0, 30]]);
  assert.deepEqual(pairs(analyzeSilence(noisy, { ...options, hysteresisDb: 0.1 })), [
    [0, 10],
    [20, 30],
  ]);
  const loud = build([
    [10, 0.001],
    [10, 0.05],
    [10, 0.001],
  ]);
  assert.equal(analyzeSilence(loud, { ...options, hysteresisDb: 6 }).silences.length, 2);
});

test('minimum duration and padding apply to final interior ranges only', () => {
  const x = build([
    [40, 0.5],
    [60, 0],
    [40, 0.5],
    [30, 0],
    [20, 0],
  ]);
  const padded = { ...base, paddingSeconds: 0.01 };
  assert.deepEqual(pairs(analyzeSilence(x, { ...padded, minSilenceSeconds: 0.04 })), [
    [50, 90],
    [150, 190],
  ]);
  assert.deepEqual(pairs(analyzeSilence(x, { ...padded, minSilenceSeconds: 0.041 })), []);
  assert.deepEqual(pairs(analyzeSilence(x, { ...base, minSilenceSeconds: 0.06 })), [[40, 100]]);
  assert.deepEqual(analyzeSilence(x, { ...base, paddingSeconds: 1 }).silences, []);
});
test('partial final block is analysed over its real length; outputs are owned', () => {
  const x = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5]);
  const result = analyzeSilence(x, { ...base, blockSize: 10 });
  assert.deepEqual(pairs(result), [[0, 10]]);
  assert.ok(Math.abs(result.blockDb[1] - 20 * Math.log10(0.5)) < 1e-12);
  result.blockDb[0] = 1;
  assert.equal(analyzeSilence(x, { ...base, blockSize: 10 }).blockDb[0], -120);
});
