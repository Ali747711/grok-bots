"""Crew: open the bot's browser once when its screen comes up (see Dockerfile).

Runs the same command as the dock's Browser launcher, which Hermes passes to the screen as
HERMES_BD_BROWSER_EXEC_LINE (a Desktop Entry `Exec=` value: every argument double-quoted, backslashes doubled).
Stays in the screen's process group, so stopping the screen also closes the browser.
"""
import os
import shlex
import subprocess
import sys

line = os.environ.get("HERMES_BD_BROWSER_EXEC_LINE", "")
if line.startswith("Exec="):
    line = line[len("Exec="):]
argv = shlex.split(line.replace("\\\\", "\\"))
if not argv:
    sys.exit(0)
subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
