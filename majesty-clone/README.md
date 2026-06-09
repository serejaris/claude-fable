# Majesty Clone — Indirect Control Kingdom Sim

Браузерный клон **Majesty: The Fantasy Kingdom Sim** (2000). Вы — корона, не командир: герои сами решают, что делать. Ваши инструменты — здания, флаги-награды и экономика.

## Как играть

- **Стройте** гильдии и нанимайте героев. У каждого героя — имя, класс (Warrior / Ranger / Wizard / Rogue) и характер: courage, greed, diligence. Трус останется трусом.
- **Ставьте флаги**: ⚑ Attack на монстра или логово, ⚑ Explore — в туман. Награду можно **только повышать**; снять флаг = сжечь золото. Это ставка, не приказ.
- Герои зарабатывают, тратят в ваших лавках (30% налога в казну) и платят гильдейскую десятину, когда отдыхают дома.
- Кликните по герою — увидите, **что он задумал** и почему отказался умирать за ваши 20 золотых.
- **Победа** — уничтожить все 6 логов. **Поражение** — потерять дворец.

Управление: drag — камера · колесо — зум · double-click по монстру — attack flag, по земле — explore flag · Space — пауза · 1/2/3 — скорость.

## Запуск

```bash
npm install
npm start          # http://localhost:3000
```

`?debug=1` в URL — AI-оверлей: клик по герою показывает топ кандидатов utility-решений со score.

## Архитектура

- `public/js/sim/` — детерминированная симуляция (10 Hz, seeded PRNG, чистые данные, ноль DOM). Весь баланс — в `sim/data.js`.
- `public/js/render/` — Canvas 2D, 3 слоя: пергамент/туман + terrain prerender, entities, effects.
- `public/js/ui/` — HTML overlay (панели, хроника, модалки).
- AI героев: advertisements → utility scoring (персональность = веса) → execution FSM. Buckets: survival > main pool > ambient.

## Headless-баланс

Симуляция запускается без браузера — скриптовый «игрок-бот» строит королевство:

```bash
npm run sim                                  # 30 минут, seed 42
node sim/headless.js --minutes 35 --seed 7 --verbose
```

Выводит по-минутные метрики (казна, faucets/drains, уровни героев, смерти, логова) + проверку детерминизма.

## Design

- `docs/GDD.md` — все дизайн-решения v1.
- `prompt.md` — исходный промпт эксперимента.
- Research (механики оригинала, utility AI, баланс-формулы) зафиксирован в research-corp: `2026-06/2026-06-09-majesty-clone-game-research.md`.
