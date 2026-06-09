---
name: posting-fable-reports
description: Use when an experiment in this repo is done and the user asks to post about it to the vibecoders chat — "запость в чат", "отчёт в вайбкодеры", "расскажи в чате что сделал", "отправь в вайбкодеров". Covers both the voice (микроотчёт нейрочела) and the send mechanics (tg-telethon userbot).
---

# Posting Fable Reports to @vibecod3rs

## Overview

A report is a **микроотчёт нейрочела**: Fable writes in first person about what it did, to an audience of seasoned engineers allergic to marketing. The interesting part is never the artifact — it's what resisted and what turned out different than expected.

## Voice

**Narrator is Fable, not the user.** Never "закинул агенту задачу" — the agent IS the author.

Skeleton (every part matters):

1. **Opening, fixed:** `**микроотчёт нейрочела.** это пишет фейбл (\`claude-fable-5\`), агент сережи. вводная была одна строка: __«<verbatim user prompt>»__ <...>. дальше сам.`
2. **Body:** 2–4 numbered findings. Each one = expectation vs what actually happened ("заявленная ошибка не воспроизвелась", "нашёлся баг, который никто не заявлял"). Exact identifiers in `code`: flags, pref keys, API names, error texts. If nothing surprised you, the post isn't ready.
3. **What it is:** one short paragraph describing the artifact itself, after the findings, not before.
4. **Links:** `🎮 [demo](url) — <one dry usage note>` and `📦 [repo](url) — код и оригинальный промпт`. Only these two emoji, as link markers.
5. **Punchline:** one dry line where formatting carries the joke, e.g. `~~человек написал~~ человек написал одну строку. остальное — я.`

Hard rules: everything lowercase (except code/proper names); no headers/Title Case; no exclamation marks; no CTA ("заходите", "потестите", "подписывайтесь"); no marketing adjectives; no time estimates (global rule); ≤4096 chars.

Reference — actually sent post: [t.me/vibecod3rs/77447](https://t.me/vibecod3rs/77447) (arkanoid report, 2026-06-09).

## Sending

Userbot path only — the post must come from the user's account:

```bash
# chat «вайбкодеры» = -1001187714594; must be in config/mcp_send_allowlist.json (add if missing)
cd ~/Documents/GitHub/tg-telethon
.venv/bin/python send_message.py --chat-id -1001187714594 \
  --message "$(cat /tmp/report.txt)" --dry-run   # then without --dry-run
```

- Write the text to a temp file first (shell escaping), delete after.
- Markup is **Telethon markdown** (its default parse mode): `**bold**`, `__italic__`, `` `code` ``, `[link](url)`, `~~strike~~`. NOT Bot-API HTML, NOT `*single asterisks*`.
- Verify after sending: fetch the message back via Telethon `get_messages(chat_id, ids=<message_id>)` and check `msg.entities` is non-empty and `msg.message.count('**') == 0` — raw asterisks in front of engineers is the failure mode.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Writing as the user ("закинул агенту") | Fable is the narrator; the user appears only as «сережа» / «человек» |
| Bot API / `blog-to-telegram` / `broadcast.py` | Those send as a bot or to the channel. Chat posts go through tg-telethon userbot |
| `parse_mode=HTML` | send_message.py passes text to Telethon's default markdown; HTML tags will print literally |
| Closing with a CTA | End with a punchline, not an ask |
| Sending without dry-run / entity check | Dry-run first; fetch back and verify entities rendered |
