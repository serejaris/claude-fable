#!/bin/zsh
# Installs the usage helper as a launchd agent (runs at login, auto-restarts).
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
# launchd has no TCC access to ~/Documents — run from a copy outside it
DIR=~/.local/share/fable-countdown
mkdir -p "$DIR"
cp "$SRC/usage_server.py" "$DIR/usage_server.py"
PLIST=~/Library/LaunchAgents/com.fable.usage.plist

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fable.usage</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>${DIR}/usage_server.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/tmp/fable-usage.err</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 1
echo "→ helper status:"
curl -s http://127.0.0.1:46123/usage | head -c 400
echo ""
echo "OK — helper installed (com.fable.usage)"
