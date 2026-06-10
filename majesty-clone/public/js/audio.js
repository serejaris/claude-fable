// Web Audio engine: lazy unlock on first gesture (autoplay policy), preload,
// per-sound throttling so 8x speed doesn't become a hit-storm, master mute.

const SOUNDS = ['hit_melee', 'hit_ranged', 'hit_magic', 'monster_death', 'hero_death',
  'levelup', 'coin', 'anvil', 'potion', 'build', 'hire', 'flag', 'lair_down',
  'wave', 'discover', 'win', 'lose', 'click'];

// min ms between plays of the same sound
const THROTTLE = {
  hit_melee: 90, hit_ranged: 90, hit_magic: 140, coin: 130, monster_death: 150, click: 60,
};
const DEFAULT_THROTTLE = 200;
const MAX_VOICES = 10;

export function createAudio() {
  let ctx = null;
  let master = null;
  const buffers = {};
  const lastAt = {};
  let voices = 0;
  let muted = false;
  try { muted = localStorage.getItem('majesty-clone-muted') === '1'; } catch { /* ignore */ }

  async function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      // preload all in parallel; failures are non-fatal (sound just stays silent)
      await Promise.all(SOUNDS.map(async name => {
        try {
          const res = await fetch(`assets/sfx/${name}.mp3`);
          buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
        } catch { /* missing sound is not a crash */ }
      }));
    } catch { ctx = null; }
  }

  function play(name, volume = 1) {
    if (!ctx || muted || volume <= 0.01) return;
    const buf = buffers[name];
    if (!buf || voices >= MAX_VOICES) return;
    const now = performance.now();
    if (now - (lastAt[name] || 0) < (THROTTLE[name] || DEFAULT_THROTTLE)) return;
    lastAt[name] = now;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(volume, 1);
    src.connect(gain).connect(master);
    voices++;
    src.onended = () => { voices--; };
    src.start();
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 1;
    try { localStorage.setItem('majesty-clone-muted', muted ? '1' : '0'); } catch { /* ignore */ }
    return muted;
  }

  return { play, unlock, toggleMute, get muted() { return muted; }, get ready() { return !!ctx; } };
}
