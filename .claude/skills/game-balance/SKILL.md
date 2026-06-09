---
name: game-balance
description: Use when tuning numbers in majesty-clone, changing sim/data.js, or investigating balance complaints (class dies too fast, economy starves, game too easy/hard, win unreachable)
---

# Game Balance — majesty-clone

## Overview
Баланс не угадывают — его измеряют. Сначала baseline-замер, потом гипотеза, потом правка **только в `sim/data.js`** (или весов в ai.js), потом контрольный замер.

## Instruments (уже существуют — не строй свои)

```bash
cd majesty-clone
node sim/headless.js --minutes 35 --seed 42            # полный прогон со скриптовым игроком-ботом
node sim/headless.js --minutes 35 --seed 7 --verbose   # + интенты выживших героев
```

- Сиды для матрицы: **42, 7, 123, 5** (минимум 3).
- Minute-log: `gold` (казна), `faucet/drain` (кумулятивно), `tax`, `heroes avgL`, `deaths kills`, `mons lairs`, `int` (director intensity).
- Точечные сценарии (дуэль класса против монстра и т.п.) — мини-скрипт в /tmp через `node --input-type=module`, импортируя sim-модули напрямую (они чистые, DOM нет).
- Десятиминутный прогон стоит секунды — НИКОГДА не коммить числа без прогона.

## Acceptance criteria (v1)

| Метрика | Норма |
|---|---|
| determinism | строка `determinism: OK` обязательна |
| Win | 15–35 мин хотя бы на половине сидов; на остальных — прогресс по логовам без фриза |
| kills | растут каждые 2–3 минуты (фриз kills = дедлок спавна) |
| drain/faucet | 0.5–1.0 (выше — голод, сильно ниже — инфляция) |
| Палач-метрика | казна не должна монотонно расти после 15-й минуты без трат |

## Pitfalls (выученные на этом проекте)

- **avgL разбавлен свежими наймами** — смотри на ветеранов (`--verbose`), не на среднее.
- Герои **копят золото и не тратят** → налоги мертвы → казна голодает. Чини желание тратить (urgency от богатства), не пассивный доход.
- Эскалация логов без капа → win недостижим. Любой ramp должен иметь cap, любой gate — fallback (см. prowlers/waves в director.js).
- Скриптовый бот слабее человека: он не концентрирует bounty. «Бот не выиграл» ≠ «игрок не выиграет».
- После правки чисел — синхронизировать `docs/GDD.md` (одной правкой).

## Red Flags
- «Поправлю на глаз, выглядит логично» → сначала baseline-прогон.
- Правка статов в combat/ai вместо data.js → баланс расползается по коду.
- Один сид «стало лучше» → минимум 3 сида.
