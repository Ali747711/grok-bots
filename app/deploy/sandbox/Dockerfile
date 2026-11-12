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

# The dock's Browser launcher uses the `internet-web-browser` icon, which the image's icon themes lack, so it
# showed as a blank shape the bot did not recognise. Use Chromium's own logo for it.
RUN set -e; logo=$(ls /opt/playwright/chromium-*/chrome-linux*/product_logo_48.png 2>/dev/null | head -1); \
    if [ -n "$logo" ]; then \
      install -D -m 0644 "$logo" /usr/share/icons/hicolor/48x48/apps/internet-web-browser.png; \
      if command -v gtk-update-icon-cache >/dev/null; then gtk-update-icon-cache -q -f /usr/share/icons/hicolor || true; fi; \
    fi

# Open the browser when the screen starts, so the bot never has to find and click the dock first: its screen
# tool clicks in the background by default, and the Xfce dock ignores such clicks (live probe, 2026-11-12).
COPY open-browser.py /usr/local/lib/crew/open-browser.py
COPY xfce4-panel-wrapper.sh /usr/local/lib/crew/xfce4-panel-wrapper.sh
# The real dock keeps its own file name (in a Crew folder), so its window still reads "xfce4-panel".
RUN mkdir -p /usr/local/lib/crew/real && mv /usr/bin/xfce4-panel /usr/local/lib/crew/real/xfce4-panel \
 && install -m 0755 /usr/local/lib/crew/xfce4-panel-wrapper.sh /usr/bin/xfce4-panel
