# Majesty Clone — Game Design Document (v1)

Browser-based indirect-control kingdom sim. Игрок никогда не командует героями напрямую — только здания, флаги-награды и экономика.

**Research:** полный отчёт — `research-corp/2026-06/2026-06-09-majesty-clone-game-research.md` (источники, формулы оригинала, уроки наследников). Здесь — только принятые решения.

## Vision

Сессия ~30 минут. Win = уничтожить все логова монстров. Lose = разрушен Palace.
Сигнатурный момент: герой подходит к bounty, оценивает риск, **отказывается и уходит** — и игрок видит почему ("too dangerous for me").

## Core Loop

1. Строишь гильдии/экономику → нанимаешь героев
2. Ставишь флаги Attack/Explore с bounty (только увеличивается, снятие сжигает золото)
3. Герои сами решают: utility AI × персональность
4. Герои зарабатывают → тратят в твоих магазинах → налог 30% возвращается в казну
5. Логова эскалируют → давление растёт → финал

## Heroes

4 класса (минимум, покрывающий все архетипы персональности):

| Класс | Цена | HP | Damage | Особенность |
|---|---|---|---|---|
| Warrior | 250g | 50 + 16L | 6 + 2.5L | melee, храбрый универсал |
| Ranger | 300g | 35 + 10L | 5 + 2.2L | ranged, fastest, исследует сам |
| Wizard | 400g | 34 + 9L | 14 + 6L per hit (cd 2.0s) | burst, kiting, трус |
| Rogue | 200g | 30 + 9L | 5 + 2.4L (cd 0.7s) | кинжальный dps, жадный скаут, клюёт на мелкие bounty |

- XP: `XP_next(L) = 60 * 1.35^(L-1)`, monsterXP = `15 * mLevel^1.5`, кап L10. Level-up = full heal.
- Атака ~1 hit/s → TTK ат-левел цели 3–5 с.
- Каждый герой: имя, 3 трейта (courage, greed, diligence) — gaussian вокруг классового baseline ±0.15:
  Warrior 0.7/0.5/0.5 · Ranger 0.5/0.4/0.8 · Wizard 0.3/0.6/0.5 · Rogue 0.3/0.9/0.7
- Трейты видимы: лейбл ("Coward", "Greedy", "Brave") + строка намерения в tooltip и панели героя.

## AI (3 слоя)

1. **Advertisements**: объекты мира публикуют `{action, baseScore, slots}` — флаг, логово, монстр, магазин, инн. Новый контент = новый объект.
2. **Utility brain** с priority buckets: `SURVIVAL > COMBAT > FLAGS > NEEDS (heal, spend, rest) > AMBIENT (explore, patrol, idle-at-inn)`.
   ```
   utility = greed * min(bounty/100, 1)
           + courage * (1 - threat)
           + diligence * novelty
           - 0.3 * dist / mapSize
   threat  = enemyPower / ownPower        // power = HP * DPS
   flee если threat > 0.6 + courage  // храбрые стоят дольше
   retreat-to-heal если HP < 30% + 20%*(1-courage)
   ```
3. **Execution mini-FSM**: `moveTo → doAction → collectReward`.

Анти-dithering: переоценка раз в 1–2 с (staggered) или по событию; commitment-маржа 20% для смены действия; cooldown на брошенные цели; slots на объявлениях против толпы у одной цели; 2% шума в score.

## Flags

- **Attack flag** — на монстра/логово; **Explore flag** — в любую точку (включая туман).
- Bounty: min 20g, +50 за клик, **только вверх**; снятие сжигает золото. Счётчик «N heroes responding».
- Награда делится между героями рядом при выполнении.
- Bounty капнут в utility (`min(bounty/100, 1)`) и не перебивает SURVIVAL — никаких suicide-rush.

## Buildings (v1)

| Здание | Цена | Функция |
|---|---|---|
| Palace | стартовое, 1100 HP | казна, trickle-доход, стрелки; разрушен = поражение |
| Warriors / Rangers / Wizards / Rogues Guild | 300–500g | найм, кап 3 героя, банковка золота |
| Marketplace | 350g | зелья 25g героям; пассив +10g/10s игроку |
| Blacksmith | 400g | апгрейды weapon 100/300/600, armor 150/450/800 — герои платят сами |
| House | 80g | пассив +2g/10s, до 6 шт |
| Graveyard | авто | мёртвый герой → могила в гильдии, revive 8×L(L+1)/2 g (анти-permadeath) |

Налог игрока: 30% с каждой покупки героя (видимый +gold попап у магазина).

## Monsters & Director

- Монстры: rat L1, goblin L2, spider L3, wolf L4, troll L6 (регенерирует), minotaur L8. HP = 30+13L, dmg = 4+2.2L.
- Логова в тумане спавнят волны и prowlers (посильных скаутов — XP-кран); +1 уровень за 7 минут жизни (кап +3). Атакованное логово жалит и выпускает защитников. Уничтожение = treasure cache.
- Director: `threatBudget(t) = 8 + 1.2 * t_min^1.4` поинтов (цена монстра = уровень), волны каждые 45–75 с; intensity-трекер (рост при уроне/смертях героев, decay 5%/с), при avg > 0.8 → Relax 30–45 с без спавнов.
- Арка: 0–5 мин тихо (L1–2), эскалация 5–20, элиты 20+, мега-логово к 25-й.

## Tech

- Vanilla JS, ES modules, **zero deps на клиенте**; Canvas 2D, 3 слоя (terrain prerender / entities / effects); HTML overlay для всего UI.
- Fixed timestep: SIM_STEP = 100ms (10 Hz), интерполяция рендера, clamp 250ms, speed {0,1,2,4}.
- Детерминизм: mulberry32 seeded PRNG в state, tick — единственные часы, sim/ не импортирует DOM. Headless-прогон `node sim/headless.js --minutes 30` для баланса.
- Save/load: `{version, state}` в localStorage, автосейв 30 sim-сек + visibilitychange.
- Весь баланс в одном data-файле (`sim/data.js`).
- Сервер: express.static, Railway (PORT env).
- Debug overlay: клик по герою → текущее действие + top-5 отвергнутых с разбивкой score.

## Out of Scope (v1)

Party formation, отношения героев, direct-control fallback, кампания/скриптовые миссии, храмы/мирные расы, заклинания суверена, fear flags, мультиплеер, мета-прогрессия.
