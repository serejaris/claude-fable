---
name: playtest-qa
description: Use when verifying that a majesty-clone feature or fix actually works — after any sim/render/UI change, before commit or deploy
---

# Playtest QA — majesty-clone

## Overview
Фича не проверена, пока её не видели **в работающей игре**. Чтение кода — это не верификация. Лестница: headless → unit-probe → live browser → prod.

## Verification Ladder

**1. Headless (обязательно после любой sim-правки):**
```bash
cd majesty-clone && node sim/headless.js --minutes 30 --seed 42
```
Последняя строка обязана быть `determinism: OK`. Сломанный детерминизм = баг, даже если игра «работает».

**2. Unit-probe** — сценарий на чистых sim-модулях (hire → kill → revive и т.п.):
```bash
node --input-type=module -e "
import { newGame, hireHero } from './public/js/sim/world.js';
import { tick } from './public/js/sim/update.js';
const st = newGame(42); /* … сценарий … */"
```

**3. Live browser (мутировать локальную игру МОЖНО и НУЖНО):**
- Сервер: `PORT=3457 node server.js` (или уже запущен — проверь `curl localhost:3457/health`).
- Chrome-devtools MCP; страница `http://localhost:3457/?debug=1`.
- Дебаг-ручки в консоли: `window.__game` (`.state`, `.view`, `.speed`), `window.__actions` (newGame, hire, flagOn…).
- Рецепты: `__game.state.gold = 5000` (чит), `__game.speed = 4` (ускорить), `import('/js/sim/world.js')` в evaluate_script даёт **те же singleton-модули** — можно вызывать addBuilding/hireHero/destroyLair напрямую.
- `?debug=1` + клик по герою → top-кандидаты utility с score — главный инструмент для AI-поведения.
- Смотреть: console errors (обязательно 0), интенты героев осмысленны, vfx события приходят, win/lose модалки.
- Свежий старт: `__actions.newGame()`. НЕ `localStorage.clear()+reload` — visibilitychange может пересохранить старый стейт.

**4. Prod** (после деплоя): https://majesty-clone-production.up.railway.app — `/health`, загрузка без console errors, network без 404 (404 сразу после `railway up` — подожди и перепроверь).

## Что считается доказательством
Конкретные значения из живого стейта («revived hero hp 49/98, home id валиден»), скриншот с видимым эффектом, строка determinism: OK. «Код выглядит правильно» доказательством не является.

## Red Flags
- «Прочитал код, всё ок» без запуска → не верификация.
- «Браузер — это не read-only, пропущу» → мутировать локальную игру можно, это песочница.
- Проверен только happy-path → проверь edge (нет золота, цель умерла, гильдия разрушена).
