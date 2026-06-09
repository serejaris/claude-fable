import { pick, rand } from './rng.js';

const FIRST = ['Bran', 'Aldric', 'Mira', 'Theo', 'Ysolt', 'Garen', 'Lira', 'Odo', 'Wynne', 'Cedric',
  'Hilda', 'Rowan', 'Eda', 'Falk', 'Nim', 'Orla', 'Pip', 'Sable', 'Tova', 'Ulf',
  'Vesna', 'Wren', 'Yorick', 'Zora', 'Ansel', 'Beryl', 'Corin', 'Dara', 'Edmund', 'Fia'];
const EPITHET = ['the Bold', 'of the Vale', 'Swiftfoot', 'the Quiet', 'Ironhand', 'the Stray',
  'of Oakhill', 'Longstride', 'the Unlucky', 'Brighteye', 'of the Mill', 'Threefingers',
  'the Younger', 'Ashborn', 'the Stubborn', 'Quickwit', 'of Lowmarsh', 'Halfboot'];

export function heroName(state) {
  return rand(state) < 0.55 ? `${pick(state, FIRST)} ${pick(state, EPITHET)}` : pick(state, FIRST);
}

// Most extreme deviation from class baseline becomes the visible personality label
export function traitLabel(traits, baseline) {
  const checks = [
    ['courage', -1, 'Coward'], ['courage', +1, 'Brave'],
    ['greed', +1, 'Greedy'], ['greed', -1, 'Selfless'],
    ['diligence', +1, 'Restless'], ['diligence', -1, 'Lazy'],
  ];
  let best = null, bestDev = 0.08; // require a meaningful deviation
  for (const [key, sign, label] of checks) {
    const dev = (traits[key] - baseline[key]) * sign;
    if (dev > bestDev) { bestDev = dev; best = label; }
  }
  if (best) return best;
  // fall back to absolute extremes
  if (traits.courage < 0.3) return 'Coward';
  if (traits.greed > 0.8) return 'Greedy';
  if (traits.courage > 0.75) return 'Brave';
  return 'Steady';
}
