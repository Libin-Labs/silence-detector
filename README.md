# @lp-labs/silence-detector

Finds silent and sound ranges in finite mono samples using block RMS levels, a hysteresis state machine, minimum duration and padding. Catalog identity 487; standalone package version 1.0.0.
No runtime, peer, or sibling dependencies. Node >=18, ESM and CommonJS with declarations.

## Install

```sh
npm install @lp-labs/silence-detector
```

## Quickstart (runnable JavaScript)

```js
import assert from 'node:assert/strict';
import { analyzeSilence } from '@lp-labs/silence-detector';
const samples = new Float32Array(1000);
for (let i = 0; i < 1000; i++) samples[i] = i < 300 || i >= 700 ? (i % 2 ? -0.5 : 0.5) : 0;
const result = analyzeSilence(samples, {
  sampleRate: 1000,
  blockSize: 50,
  thresholdDb: -50,
  paddingSeconds: 0.05,
});
assert.deepEqual(
  result.silences.map((r) => [r.startSample, r.endSample]),
  [[350, 650]],
);
assert.equal(result.sounds.length, 2);
assert.equal(result.silences[0].durationSeconds, 0.3);
```

## Configuration and errors

`analyzeSilence(samples, options)`: `sampleRate`, `blockSize` (samples per non-overlapping block) and `thresholdDb` (dBFS, at most 0) are required. A block is silent when its RMS is below `thresholdDb`; once silent, the run only ends at a block whose RMS is at least `thresholdDb + hysteresisDb` (`hysteresisDb` >= 0, default 0). `minSilenceSeconds` (default 0) drops final ranges shorter than `round(seconds * sampleRate)` samples. `paddingSeconds` (default 0) moves each interior boundary of a silent range inward, so that much audio next to sound stays sound; boundaries at the start or end of the input are not padded. Minimum duration is evaluated after padding. `floorDb` (default -120) is the level reported for zero RMS. `maxSamples` (default 67108864) bounds input size.

`blockLevelsDb(samples, blockSize, floorDb?)` returns the per-block RMS level. The result has `blockDb`, `blockSilent` (before duration/padding rules), `silences` and complementary `sounds` with sample and second positions.

Errors: `TypeError` for non-Float32Array/Float64Array/array samples or non-object options; `RangeError` for NaN/Infinity samples, invalid numbers and exceeded `maxSamples`.

## Complete public declarations

Every runtime export and public type is shown below. This is the complete emitted declaration surface.

```ts
export type SampleBuffer = Float32Array | Float64Array | readonly number[];
export interface SilenceOptions {
  sampleRate: number;
  blockSize: number;
  thresholdDb: number;
  hysteresisDb?: number;
  minSilenceSeconds?: number;
  paddingSeconds?: number;
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
  blockSilent: Uint8Array;
  silences: SampleRange[];
  sounds: SampleRange[];
}
export declare const DEFAULT_MAX_SAMPLES = 67108864;
export declare function blockLevelsDb(
  samples: SampleBuffer,
  blockSize: number,
  floorDb?: number,
): Float64Array;
export declare function analyzeSilence(
  samples: SampleBuffer,
  options: SilenceOptions,
): SilenceAnalysis;
```

## Performance, boundaries and limitations

This is a plain level threshold on RMS blocks: it does not infer speech, music or noise, does not weight frequencies, and has no look-ahead beyond block granularity, so boundaries are multiples of `blockSize` (plus or minus padding). The final partial block is measured over its real length. Silence is relative to digital full scale (a constant 1.0 is 0 dB). Mono only: mix or analyse each channel yourself. Time and memory are O(n) with one Float64 per block. Inputs are never modified and outputs are owned.

## Development

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

The offline install requires the locked development dependencies already in the npm cache.
Build emits separate ESM/CJS and declarations; type checks include bare-package .mts/.cts consumers with negative cases.
Runtime tests import only the single-quoted standalone dist entry and also run against installed offline tarballs.
No build artifacts or development dependencies are required at runtime.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
