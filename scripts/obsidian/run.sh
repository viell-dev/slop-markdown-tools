#!/bin/sh
# Starts a virtual display for Obsidian and runs the check in it.
set -eu
export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1400x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
sleep 1
exec npx wdio run /check/wdio.conf.mjs
