#!/usr/bin/env python3
"""Fable Countdown usage helper.

Serves Claude subscription limits (5h session / weekly windows) to the
new-tab extension at http://127.0.0.1:46123/usage.

Why this exists: a Chrome extension cannot read the macOS Keychain, so it
cannot call api.anthropic.com/api/oauth/usage itself. This tiny server
reads the Claude Code OAuth token from the Keychain, polls the endpoint,
and exposes only normalized percentages + reset timestamps — the token
never leaves this process.

Stdlib only. The endpoint rate-limits aggressively, so responses are
cached and stale data is served on errors.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 46123
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CACHE_TTL = 180          # seconds between upstream polls
RETRY_AFTER = 120        # backoff between failed upstream attempts (endpoint rate-limits hard)
STALE_OK = 6 * 3600      # serve stale cache up to this age on upstream errors

_cache = {"data": None, "fetched_at": 0.0, "attempted_at": 0.0, "cooldown_until": 0.0}
_lock = threading.Lock()


def keychain_token() -> str | None:
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        return json.loads(raw)["claudeAiOauth"]["accessToken"]
    except Exception:
        return None


def to_pct(value) -> float | None:
    # utilization is documented 0-100 (zod schema in the Claude Code bundle)
    if not isinstance(value, (int, float)):
        return None
    return round(min(100.0, max(0.0, float(value))), 1)


def to_iso(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):  # epoch seconds
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    return None


def normalize(raw: dict) -> dict:
    """Extract {session, week} windows from whatever shape the endpoint returns.

    Tolerates schema drift: any top-level object carrying utilization +
    resets_at is treated as a window; keys decide which slot it fills.
    """
    windows = {}
    for key, val in raw.items():
        if not isinstance(val, dict):
            continue
        util = val.get("utilization", val.get("used_percent", val.get("usage")))
        resets = val.get("resets_at", val.get("reset_at", val.get("resets")))
        pct = to_pct(util)
        if pct is None:
            continue
        windows[key] = {"pct": pct, "resets_at": to_iso(resets)}

    def pick(*needles):
        for n in needles:  # exact key first (seven_day, not seven_day_opus)
            if n in windows:
                return windows[n]
        for k, w in windows.items():
            lk = k.lower()
            if any(n in lk for n in needles):
                return w
        return None

    return {
        "session": pick("five_hour", "5h", "session"),
        "week": pick("seven_day", "7d", "week"),
        "windows": windows,  # everything found, for forward compatibility
    }


def fetch_upstream() -> dict | None:
    token = keychain_token()
    if not token:
        return None
    req = urllib.request.Request(USAGE_URL, headers={
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-cli/2.1.170 (external, cli)",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # the endpoint rate-limits per hourly bucket; honor its retry-after
        if e.code == 429:
            ra = e.headers.get("retry-after", "")
            if ra.isdigit():
                _cache["cooldown_until"] = time.time() + int(ra)
        return None
    except Exception:
        return None
    if "error" in raw:
        return None
    return normalize(raw)


def get_usage() -> dict:
    with _lock:
        now = time.time()
        age = now - _cache["fetched_at"]
        if _cache["data"] is not None and age < CACHE_TTL:
            return {"ok": True, "stale": False, "age": int(age), **_cache["data"]}

        if now - _cache["attempted_at"] >= RETRY_AFTER and now >= _cache["cooldown_until"]:
            _cache["attempted_at"] = now
            fresh = fetch_upstream()
            if fresh is not None:
                _cache["data"] = fresh
                _cache["fetched_at"] = time.time()
                return {"ok": True, "stale": False, "age": 0, **fresh}

        if _cache["data"] is not None and age < STALE_OK:
            return {"ok": True, "stale": True, "age": int(age), **_cache["data"]}
        return {"ok": False}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") not in ("/usage", ""):
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(get_usage()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # keep launchd logs quiet


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
