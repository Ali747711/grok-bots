# Crew's sandbox image: Hermes's desktop sandbox plus one fix for ARM machines.
#
# Hermes finds the bot's Chromium with a probe that looks only in chromium-*/chrome-linux/ and
# chromium-*/chrome-linux64/ (HA/tools/bot_desktop/sandbox_host.py:139-144). On arm64 the image keeps it in
# chromium-*/chrome-linux-arm64/, so the probe finds nothing and the bot's screen gets no Browser on its dock.
# The link below makes the probe find the same binary. Remove this image once Hermes's probe knows arm64.
#
# Build: docker build -t crew-sandbox:desktop app/deploy/sandbox
FROM nousresearch/hermes-sandbox:desktop
RUN set -e; for d in /opt/playwright/chromium-*; do \
      if [ -d "$d/chrome-linux-arm64" ] && [ ! -e "$d/chrome-linux" ]; then ln -s chrome-linux-arm64 "$d/chrome-linux"; fi; \
    done
