import {
  analyzeSilence,
  blockLevelsDb,
  type SampleRange,
  type SilenceAnalysis,
  type SilenceOptions,
} from '@lp-labs/silence-detector';
const options: SilenceOptions = {
  sampleRate: 8000,
  blockSize: 80,
  thresholdDb: -50,
  hysteresisDb: 6,
};
const analysis: SilenceAnalysis = analyzeSilence(new Float32Array(800), options);
const first: SampleRange | undefined = analysis.silences[0];
first?.durationSeconds.toFixed();
blockLevelsDb([0, 1], 1, -90).length.toFixed();
// @ts-expect-error thresholdDb is required
analyzeSilence([0], { sampleRate: 1, blockSize: 1 });
// @ts-expect-error samples must be numeric arrays
analyzeSilence('abc', options);
