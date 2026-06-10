// HTML overlay UI: resource bar, build menu, selection panel, chronicle ticker, modals.
// All chrome lives in DOM (Pocket City pattern); canvas only draws world-space things.

import { BUILDINGS, CLASSES, ECON, MONSTERS, SIM_DT } from '../sim/data.js';
import { reviveHero } from '../sim/combat.js';

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export function createUI(game, actions) {
  const goldEl = $('#gold'), dayEl = $('#day'), popEl = $('#pop'), rateEl = $('#rate');
  const panel = $('#panel'), ticker = $('#ticker'), modal = $('#modal');
  let lastPanelKey = '';
  let lastPanelAt = 0;

  // ---------- build menu ----------
  const buildMenu = $('#build-menu');
  const buildable = ['guild_warrior', 'guild_ranger', 'guild_wizard', 'guild_rogue', 'market', 'blacksmith', 'house'];
  for (const type of buildable) {
    const def = BUILDINGS[type];
    const btn = el('button', 'build-btn', `<span class="b-name">${def.label}</span><span class="b-cost">${def.cost} з.</span>`);
    btn.dataset.type = type;
    btn.title = buildTooltip(type);
    btn.onclick = () => actions.setMode(game.view.mode === 'build:' + type ? null : 'build:' + type);
    buildMenu.appendChild(btn);
  }
  const flagAtkBtn = $('#flag-attack'), flagExpBtn = $('#flag-explore');
  flagAtkBtn.onclick = () => actions.setMode(game.view.mode === 'flag:attack' ? null : 'flag:attack');
  flagExpBtn.onclick = () => actions.setMode(game.view.mode === 'flag:explore' ? null : 'flag:explore');

  function buildTooltip(type) {
    const t = {
      house: 'Пассивный доход. Королевство растёт.',
      market: 'Продаёт героям зелья. Пассивный доход + 30% налога с покупок.',
      blacksmith: 'Герои покупают апгрейды оружия и брони за своё золото.',
      guild_warrior: 'Нанимайте воинов — храбрая передовая, откликаются на тревогу.',
      guild_ranger: 'Нанимайте следопытов — быстрые разведчики, исследуют сами.',
      guild_wizard: 'Нанимайте магов — стеклянные пушки: трусливы, но смертоносны.',
      guild_rogue: 'Нанимайте плутов — жадные трусы, любая мелкая награда их манит.',
    };
    return t[type] || '';
  }

  // ---------- speed controls ----------
  for (const b of document.querySelectorAll('.speed-btn')) {
    b.onclick = () => actions.setSpeed(+b.dataset.speed);
  }
  $('#btn-save').onclick = () => { actions.save(); toast('Королевство сохранено.'); };
  $('#btn-new').onclick = () => confirmModal('Начать новое королевство? Текущий прогресс будет потерян.', actions.newGame);
  $('#btn-help').onclick = () => showHelp();

  // ---------- per-frame update ----------

  function update(state) {
    goldEl.textContent = Math.floor(state.gold);
    rateEl.textContent = `+${game.incomeRate || 0}/мин`;
    rateEl.style.opacity = (game.incomeRate || 0) > 0 ? 1 : 0.5;
    const sec = Math.floor(state.tick * SIM_DT);
    dayEl.textContent = `День ${1 + Math.floor(sec / 120)} · ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    popEl.textContent = `героев: ${state.heroes.length}`;

    for (const b of buildMenu.children) {
      const def = BUILDINGS[b.dataset.type];
      b.classList.toggle('active', game.view.mode === 'build:' + b.dataset.type);
      b.classList.toggle('disabled', state.gold < def.cost);
    }
    flagAtkBtn.classList.toggle('active', game.view.mode === 'flag:attack');
    flagExpBtn.classList.toggle('active', game.view.mode === 'flag:explore');
    for (const b of document.querySelectorAll('.speed-btn')) {
      b.classList.toggle('active', +b.dataset.speed === game.speed);
    }

    updatePanel(state);

    if (state.result && !modal.dataset.shown) {
      modal.dataset.shown = '1';
      showResult(state);
    }
  }

  // ---------- selection panel ----------

  function updatePanel(state) {
    const sel = game.view.selected;
    const key = sel ? `${sel.kind}:${sel.id}` : 'none';
    const now = performance.now();
    if (key === lastPanelKey && now - lastPanelAt < 250) return;
    lastPanelKey = key; lastPanelAt = now;

    if (!sel) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    const setPanel = html => {
      if (panel._lastHtml === html) return false;
      panel._lastHtml = html;
      panel.innerHTML = html;
      return true;
    };

    if (sel.kind === 'hero') {
      const h = state.heroes.find(x => x.id === sel.id);
      if (!h) { game.view.selected = null; panel.classList.add('hidden'); return; }
      const cls = CLASSES[h.cls];
      setPanel(`
        <div class="p-head"><span class="p-sigil" style="background:${cls.color}"></span>
          <div><div class="p-name">${h.name}</div>
          <div class="p-sub">${cls.label} · уровень ${h.level} · <em class="trait">${h.label}</em></div></div></div>
        <div class="p-intent">“${h.intent}”</div>
        <div class="p-rows">
          <div>Здоровье <b>${Math.ceil(h.hp)}/${h.maxHp}</b></div>
          <div>Золото <b>${h.gold}</b></div>
          <div>Опыт <b>${h.xp}</b></div>
          <div>Убийств <b>${h.kills}</b></div>
          <div>Оружие <b>${'★'.repeat(h.weaponTier) || '—'}</b></div>
          <div>Броня <b>${'★'.repeat(h.armorTier) || '—'}</b></div>
          <div>Зелья <b>${h.potions}</b></div>
        </div>
        <div class="p-traits">
          ${traitBar('Храбрость', h.traits.courage)}
          ${traitBar('Жадность', h.traits.greed)}
          ${traitBar('Рвение', h.traits.diligence)}
        </div>
        ${game.debug && h._debug ? debugBlock(h) : ''}`);
    } else if (sel.kind === 'building') {
      const b = state.buildings.find(x => x.id === sel.id);
      if (!b) { game.view.selected = null; panel.classList.add('hidden'); return; }
      const def = BUILDINGS[b.type];
      let extra = '';
      if (def.hires) {
        const cls = CLASSES[def.hires];
        const roster = state.heroes.filter(h => h.home === b.id);
        const graves = state.graves.filter(g => g.home === b.id);
        extra = `<div class="p-roster">${roster.map(h => `<div class="r-row">⚔ ${h.name} <span>L${h.level}</span></div>`).join('')}
          ${graves.map(g => {
            const cost = Math.round(ECON.revivePerLevel * g.level * (g.level + 1) / 2);
            return `<div class="r-row dead">☠ ${g.name} <button class="revive-btn" data-grave="${g.id}">Воскресить за ${cost}</button></div>`;
          }).join('')}</div>
          <button id="hire-btn" class="big-btn" ${state.gold < cls.cost || roster.length + graves.length >= def.cap ? 'disabled' : ''}>
            Нанять: ${cls.label} — ${cls.cost} зол. (${roster.length + graves.length}/${def.cap})</button>`;
      }
      if (b.type === 'palace') {
        // orphaned graves (guild destroyed) are revivable at the palace
        const orphans = state.graves.filter(g => !state.buildings.some(x => x.id === g.home));
        const passivePerMin = Math.round(state.buildings.reduce((sum, x) => sum + (BUILDINGS[x.type].income || 0), 0) * 60 / ECON.incomeEvery);
        extra = `<div class="p-rows"><div>Казна <b>${Math.floor(state.gold)}</b></div>
          <div>Доход зданий <b>+${passivePerMin}/мин</b></div>
          <div>Налогов собрано <b>${state.stats.taxes}</b></div>
          <div>Приток сейчас <b>+${game.incomeRate || 0}/мин</b></div></div>
        <div class="p-intent">Дома, рынок и дворец платят постоянно. Герои несут 30% с покупок и десятину, когда отдыхают дома.</div>
          ${orphans.length ? `<div class="p-roster">${orphans.map(g => {
            const cost = Math.round(ECON.revivePerLevel * g.level * (g.level + 1) / 2);
            return `<div class="r-row dead">☠ ${g.name} <button class="revive-btn" data-grave="${g.id}">Воскресить за ${cost}</button></div>`;
          }).join('')}</div>` : (state.graves.length ? '<div class="p-sub" style="margin-top:6px">Павшие герои покоятся в своих гильдиях.</div>' : '')}`;
      }
      const changed = setPanel(`
        <div class="p-head"><span class="p-sigil building"></span>
          <div><div class="p-name">${def.label}</div>
          <div class="p-sub">прочность ${Math.ceil(b.hp)}/${b.maxHp}</div></div></div>
        ${extra}`);
      if (!changed) return;
      const hireBtn = $('#hire-btn');
      if (hireBtn) hireBtn.onclick = () => { actions.hire(b); lastPanelKey = ''; };
      for (const rb of panel.querySelectorAll('.revive-btn')) {
        rb.onclick = () => {
          const grave = state.graves.find(g => g.id === +rb.dataset.grave);
          if (grave) { reviveHero(state, grave); lastPanelKey = ''; }
        };
      }
    } else if (sel.kind === 'lair') {
      const l = state.lairs.find(x => x.id === sel.id);
      if (!l || l.hp <= 0) { game.view.selected = null; panel.classList.add('hidden'); return; }
      const changed = setPanel(`
        <div class="p-head"><span class="p-sigil lair"></span>
          <div><div class="p-name">${l.label}</div>
          <div class="p-sub">прочность ${Math.ceil(l.hp)}/${l.maxHp}</div></div></div>
        <div class="p-intent">Плодит монстров, пока не уничтожено. Поставьте флаг атаки, чтобы созвать героев.</div>
        <button id="lair-flag-btn" class="big-btn">⚑ Награда за логово — ${ECON.flagMin} зол.</button>`);
      if (!changed) return;
      $('#lair-flag-btn').onclick = () => { actions.flagOn(l); lastPanelKey = ''; };
    } else if (sel.kind === 'flag') {
      const f = state.flags.find(x => x.id === sel.id);
      if (!f) { game.view.selected = null; panel.classList.add('hidden'); return; }
      const changed = setPanel(`
        <div class="p-head"><span class="p-sigil flag"></span>
          <div><div class="p-name">${f.flagType === 'attack' ? 'Флаг атаки' : 'Флаг разведки'}</div>
          <div class="p-sub">Награда <b>${f.bounty} зол.</b> · откликнулось: ${f.responders || 0}</div></div></div>
        <div class="p-intent">Награду можно только повышать. Снятие флага сжигает золото.</div>
        <button id="boost-btn" class="big-btn" ${game.state.gold < ECON.flagStep ? 'disabled' : ''}>Повысить награду +${ECON.flagStep} зол.</button>
        <button id="burn-btn" class="big-btn danger">Снять флаг (сжечь ${f.bounty} зол.)</button>`);
      if (!changed) return;
      $('#boost-btn').onclick = () => { actions.boost(f); lastPanelKey = ''; };
      $('#burn-btn').onclick = () => { actions.unflag(f); game.view.selected = null; lastPanelKey = ''; };
    } else if (sel.kind === 'monster') {
      const m = state.monsters.find(x => x.id === sel.id);
      if (!m) { game.view.selected = null; panel.classList.add('hidden'); return; }
      const changed = setPanel(`
        <div class="p-head"><span class="p-sigil monster"></span>
          <div><div class="p-name">${MONSTERS[m.type].label} <span class="p-sub">ур. ${m.level}</span></div>
          <div class="p-sub">здоровье ${Math.ceil(m.hp)}/${m.maxHp}</div></div></div>
        <button id="mon-flag-btn" class="big-btn">⚑ Награда за голову — ${ECON.flagMin} зол.</button>`);
      if (!changed) return;
      $('#mon-flag-btn').onclick = () => { actions.flagOn(m); lastPanelKey = ''; };
    }
  }

  const traitBar = (name, v) => `
    <div class="t-row"><span>${name}</span>
      <span class="t-bar"><span style="width:${Math.round(v * 100)}%"></span></span></div>`;

  function debugBlock(h) {
    return `<div class="p-debug"><b>Кандидаты AI</b>${(h._debug || []).map(d =>
      `<div class="d-row">${d.what} <span>${(+d.score).toFixed(2)}${d.threat ? ' t' + d.threat : ''}</span></div>`).join('')}</div>`;
  }

  // ---------- chronicle ticker ----------

  const tickerMsgs = [];
  function chronicle(text, cls = '') {
    tickerMsgs.push({ text, cls });
    if (tickerMsgs.length > 60) tickerMsgs.shift();
    const row = el('div', 'tick-row ' + cls, text);
    ticker.appendChild(row);
    while (ticker.children.length > 8) ticker.removeChild(ticker.firstChild);
    setTimeout(() => { row.classList.add('fade'); }, 6500);
    setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 8000);
  }

  function toast(text) { chronicle(text, 'good'); }

  // ---------- modals ----------

  function showResult(state) {
    const win = state.result === 'win';
    const sec = Math.floor(state.tick * SIM_DT);
    modal.innerHTML = `
      <div class="modal-card">
        <h2>${win ? '👑 Королевство выстояло' : '☠ Дворец пал'}</h2>
        <p>${win
          ? 'Все логова уничтожены. Барды сложат песни о ваших героях-идиотах.'
          : 'Королевство пало. Герои разбрелись по тавернам рассказывать, как они почти успели.'}</p>
        <div class="m-stats">
          <div>Время <b>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</b></div>
          <div>Героев нанято/пало <b>${state.heroes.length + state.graves.length}/${state.stats.heroDeaths}</b></div>
          <div>Монстров убито <b>${state.stats.monsterKills}</b></div>
          <div>Налогов собрано <b>${state.stats.taxes} зол.</b></div>
        </div>
        <button class="big-btn" id="modal-new">Новое королевство</button>
      </div>`;
    modal.classList.remove('hidden');
    $('#modal-new').onclick = () => { modal.classList.add('hidden'); delete modal.dataset.shown; actions.newGame(); };
  }

  function confirmModal(text, onYes) {
    modal.innerHTML = `
      <div class="modal-card">
        <p>${text}</p>
        <button class="big-btn" id="m-yes">Да</button>
        <button class="big-btn danger" id="m-no">Отмена</button>
      </div>`;
    modal.classList.remove('hidden');
    $('#m-yes').onclick = () => { modal.classList.add('hidden'); onYes(); };
    $('#m-no').onclick = () => modal.classList.add('hidden');
  }

  function showHelp() {
    modal.innerHTML = `
      <div class="modal-card help">
        <h2>Majesty Clone — Indirect Control</h2>
        <p>Вы — корона, не командир. Герои сами решают, что делать. Ваши инструменты:</p>
        <ul>
          <li><b>Стройте</b> гильдии и нанимайте героев — у каждого свой характер (трус, жадина, храбрец).</li>
          <li><b>Ставьте флаги-награды</b>: ⚑ Атака — на монстра или логово, ⚑ Разведка — в любую точку тумана. Награда делится между героями рядом.</li>
          <li>Награду можно <b>только повышать</b> (+${ECON.flagStep}g). Снять флаг = сжечь золото.</li>
          <li><b>Экономика</b>: дома, рынок и дворец капают золото постоянно (стройте их первыми!). Герои тратят заработанное в ваших лавках — <b>30% налога</b> в казну — и платят <b>десятину</b>, отдыхая дома. Индикатор «+N/мин» наверху показывает приток.</li>
          <li>Кликните по герою, чтобы увидеть, <b>что он задумал</b> — и почему отказался умирать за ваши 20 золотых.</li>
        </ul>
        <p><b>Победа</b> — уничтожить все логова. <b>Поражение</b> — потерять дворец.</p>
        <p class="p-sub">Управление: перетаскивание — камера · колесо — зум · двойной клик по монстру — флаг атаки · по земле — флаг разведки · Space — пауза · 1/2/3 — скорость</p>
        <button class="big-btn" id="m-ok">За королевство!</button>
      </div>`;
    modal.classList.remove('hidden');
    $('#m-ok').onclick = () => modal.classList.add('hidden');
  }

  return { update, chronicle, toast, showHelp };
}
