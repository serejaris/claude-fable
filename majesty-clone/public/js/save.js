// Versioned save in localStorage. Sim state is pure data, so this is trivial —
// underscore-prefixed keys are transient caches and are stripped.

import { SAVE_VERSION } from './sim/data.js';
import { rebuildBuildGrid } from './sim/world.js';

const KEY = 'majesty-clone-save';

export function saveGame(state) {
  try {
    const blob = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      state: JSON.parse(JSON.stringify(state, (k, v) => (k.startsWith('_') ? undefined : v))),
    };
    blob.state.events = [];
    localStorage.setItem(KEY, JSON.stringify(blob));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

const migrations = {
  // 1 -> 2 migrations land here
};

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw);
    let v = blob.version || 1;
    while (v < SAVE_VERSION) {
      if (!migrations[v]) return null;
      blob.state = migrations[v](blob.state);
      v++;
    }
    const state = blob.state;
    state.events = [];
    rebuildBuildGrid(state);
    return state;
  } catch (e) {
    console.warn('load failed', e);
    return null;
  }
}

export const hasSave = () => {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
};

export const clearSave = () => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};
