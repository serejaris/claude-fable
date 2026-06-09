// Tick orchestrator: one deterministic 100ms step of the whole simulation.

import { SIM_DT } from './data.js';
import { updateDirector } from './director.js';
import { updateMonsters } from './monsters.js';
import { updateHeroes } from './ai.js';
import { updateEconomy, updateFlags } from './economy.js';
import { updateDefenses } from './combat.js';
import { aliveLairs } from './world.js';

export function tick(state) {
  if (state.result) return;
  state.tick++;
  updateEconomy(state);
  updateDirector(state);
  updateMonsters(state);
  updateHeroes(state);
  updateDefenses(state);
  updateFlags(state);

  // win condition: every lair destroyed
  if (aliveLairs(state).length === 0) state.result = 'win';

  // cap transient event queue (UI consumes it; headless just lets it roll)
  if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
}
