# claude-fable

Sandbox for testing **Fable 5** (`claude-fable-5`) — Anthropic's latest model.
Each experiment lives in its own subfolder; root is never a workdir.

## Boundaries

| | Rule |
|---|------|
| ✅ Always | Create a new subfolder per project before starting any work |
| ✅ Always | Save the original user prompt in the task description when creating via Skill Manager |
| ✅ Always | Mask secrets in all output and thinking — screen is shared during live sessions |
| 🚫 Never | Print tokens, API keys, passwords, or secrets in full — use `sk-...****` / `ghp_****` form |
| 🚫 Never | Create files directly in the repo root (except this CLAUDE.md) |
| 🚫 Never | Mix experiments — one folder per concept/test |

## Project Structure

```
claude-fable/
├── CLAUDE.md
└── <project-slug>/        ← create here, never in root
    ├── prompt.md          ← original prompt verbatim
    └── ...
```

## Starting a New Experiment

1. Pick a short slug: `kebab-case`, descriptive
2. `mkdir <slug>` — all work goes inside
3. Save original prompt to `<slug>/prompt.md` before starting
4. Use model `claude-fable-5` for all generation tasks

## Model

| ID | Use |
|----|-----|
| `claude-fable-5` | Default for all experiments in this repo |
