#!/bin/sh
# Crew: Hermes starts the bot's desktop piece by piece and runs no autostart, so the dock's own start is the
# hook. Open the bot's browser once (not on a dock restart while it is already open), then start the real dock.
if [ -n "${HERMES_BD_BROWSER_EXEC_LINE:-}" ] && ! pgrep -x chrome >/dev/null 2>&1; then
  ( sleep 3; python3 /usr/local/lib/crew/open-browser.py ) &
fi
exec /usr/local/lib/crew/real/xfce4-panel "$@"
