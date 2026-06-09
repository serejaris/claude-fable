---
name: game-designer
description: Use when adding or changing game mechanics in majesty-clone (new hero class, building, monster, flag type, behavior) — before writing any code for the feature
---

# Game Designer — majesty-clone

## Overview
majesty-clone жив, пока держится ядро жанра. Любая новая механика проектируется как **данные поверх общих систем**, не как новые ветки кода.

## Genre Kernel — нерушимые инварианты

1. **Никакого прямого контроля.** Игрок влияет только зданиями, флагами, экономикой. Любая фича вида «прикажи герою» — отклонить.
2. **Персональность = utility-веса.** Характер — это числа в `data.js` (traits, affinity, кривые), НИКОГДА не `if (hero.cls === 'x')` в AI. Новое поведение = новый advertisement/candidate, доступный всем по весам. Анти-паттерн: «husk heroes» Majesty 2.
3. **Экономика циркулирует.** Новое золото обязано иметь faucet И drain (см. `stats.faucets/drains`). Не капать экономику.
4. **Легибельность.** Каждое новое поведение героя получает intent-строку («tending to X»). Отказ героя — продукт, только если игрок видит причину.
5. **Bounty необратим**, survival-bucket не перебивается никаким bounty (анти-suicide-rush).

## Workflow

1. Прочитать `majesty-clone/docs/GDD.md` (+ при сомнениях research: `research-corp/2026-06/2026-06-09-majesty-clone-game-research.md`).
2. Спроектировать фичу как данные: что добавится в `sim/data.js`; какой объект публикует advertisement; какие веса/кривые.
3. Каскад файлов для типичных фич: data.js → combat.js/economy.js (действие) → ai.js (candidate + intent + actionStillValid + execute case) → renderer.js (вид) → main.js (event→vfx) → ui.js (меню/панель) → sim/headless.js (бот использует фичу).
4. Сейвы: аддитивные поля не требуют миграции; перелом схемы → bump `SAVE_VERSION` + миграция в `save.js`.
5. **Обновить GDD** (одна правка в нужной секции) — data.js источник чисел, GDD источник решений.
6. Валидация — REQUIRED SUB-SKILL: `game-balance` (числа) и `playtest-qa` (поведение вживую).

## Red Flags
- «Просто добавлю if по классу в ai.js» → в данные.
- Фича без intent-строки → игрок увидит «тупого героя».
- Новый доход без drain → инфляция к 15-й минуте.
- Код написан, GDD не тронут → источник решений сгнил.
