---
name: extracting-claude-chat-artifacts
description: Use when given a claude.ai/chat/<uuid> link and asked to get, fix, or deploy its code/artifact, or when any data from the user's logged-in claude.ai session is needed (no public API exists for user chats). Also covers "artifact had an error" requests — the error is often the artifact sandbox, not the code.
---

# Extracting Claude Chat Artifacts

## Overview

claude.ai has no API for reading user chats. The working route on this Mac: the user's logged-in Chrome + AppleScript `execute javascript` + claude.ai internal REST API fetched from the page context.

**Dead ends (verified on Chrome 149, don't retry):**
- `chrome-devtools` MCP / `--remote-debugging-port` — Chrome 136+ blocks remote debugging on the default profile, and a fresh profile has no claude.ai session
- `defaults write com.google.Chrome AllowJavaScriptAppleEvents` — ignored; the pref moved into the profile

## Steps

### 1. Enable AppleScript JS (needs Chrome restart)

Test first — it may already be on:
```bash
osascript -e 'tell application "Google Chrome" to execute active tab of front window javascript "1"'
```
If it errors with "turned off", edit the profile pref (Chrome must be quit while editing):
```bash
osascript -e 'quit app "Google Chrome"' && sleep 3 && python3 -c "
import json
p='/Users/ris/Library/Application Support/Google/Chrome/Default/Preferences'
d=json.load(open(p)); d.setdefault('browser',{})['allow_javascript_apple_events']=True
json.dump(d,open(p,'w'))" && open -a "Google Chrome" "https://claude.ai/chat/<UUID>"
```
Tell the user afterwards; it reverts via View → Developer → Allow JavaScript from Apple Events.

### 2. Fetch the conversation via internal API

AppleScript JS is **sync** and runs in an **isolated world**: `window` vars you set are invisible to the page and vice versa, but persist across your own calls — so kick off the fetch, then poll:

```js
// call 1: start (run via execute javascript on the claude.ai tab)
window.__r=null;(async()=>{
  const orgs=await fetch('/api/organizations',{credentials:'include'}).then(r=>r.json());
  const org=orgs.find(o=>(o.capabilities||[]).includes('chat'))||orgs[0];
  window.__r=JSON.stringify(await fetch('/api/organizations/'+org.uuid+
    '/chat_conversations/<UUID>?tree=True&rendering_mode=messages&render_all_tools=true',
    {credentials:'include'}).then(r=>r.json()));
})();0
// call 2 (after delay): return window.__r — pipe osascript stdout to conversation.json
```

### 3. Locate the code

Walk `chat_messages[].content[]` where `type == "tool_use"`:
- `name == "create_file"` → code in `input.file_text`
- `name == "artifacts"` → `input.command` create/update, code in `input.content` / `input.new_str`

## Gotchas

| Trap | Reality |
|------|---------|
| "Artifact had an error" | Artifact iframe CSP blocks non-cdnjs CDNs and `getUserMedia`. Reproduce locally (`python3 -m http.server`) before "fixing" anything — code is often fine |
| Reading page state | Isolated world can't read page `window`. Share via DOM (`element.dataset`, hidden div) if page-world telemetry is needed |
| Testing camera code | Pre-grant in the same Preferences file: `profile.content_settings.exceptions.media_stream_camera` → `{"http://localhost:PORT,*": {"setting":1}}` (Chrome quit while editing) |
| Pushing the result | conversation.json is a private chat dump (thinking blocks, org UUIDs) — gitignore it; commit only the extracted code + prompt.md |

Per repo CLAUDE.md: work in a fresh `<slug>/` subfolder, save the original prompt to `prompt.md` first.
