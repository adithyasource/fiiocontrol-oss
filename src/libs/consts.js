export const SAMPLE_RATE = 44100;
export const MIN_FREQ = 20;
export const MAX_FREQ = 20000;
export const MIN_GAIN = -12;
export const MAX_GAIN = 12;

export const TYPE_MAP = { PK: 0, LSC: 1, HSC: 2 };
export const REV_TYPE_MAP = { 0: "PK", 1: "LSC", 2: "HSC" };

export const DEFAULT_BANDS = [
  { type: "PK", gain: 0, freq: 100, q: 0.7 },
  { type: "PK", gain: 0, freq: 500, q: 0.7 },
  { type: "PK", gain: 0, freq: 1000, q: 0.7 },
  { type: "PK", gain: 0, freq: 2500, q: 0.7 },
  { type: "PK", gain: 0, freq: 10000, q: 0.7 },
];
