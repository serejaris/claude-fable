// Seeded PRNG (mulberry32). All sim randomness flows through state.rngState —
// never Math.random inside sim code (determinism for headless balance runs).

export function rand(state) {
  let t = (state.rngState = (state.rngState + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (s, a, b) => a + rand(s) * (b - a);
export const randInt = (s, a, b) => Math.floor(randRange(s, a, b + 1));
export const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];

// approximate gaussian: mean of 3 uniforms, scaled
export const gaussian = (s, mean, dev) =>
  mean + (rand(s) + rand(s) + rand(s) - 1.5) * dev * 1.63;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
