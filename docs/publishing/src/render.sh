#!/bin/zsh
# Render the Figma Community cover and gallery images (1920 × 1080) into docs/publishing/.
# Needs Google Chrome and a fresh build (npm run build): the plugin windows are the real dist/ui.html.
set -e
D=${0:a:h}
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE=$(mktemp -d)
for page in cover gallery-1-select gallery-2-formats gallery-3-properties gallery-4-any-selection gallery-5-paste gallery-6-export-all gallery-7-native; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --window-size=1920,1080 --virtual-time-budget=4000 \
    --user-data-dir="$PROFILE" --screenshot="$D/../$page.png" "file://$D/$page.html" >/dev/null 2>&1
  echo "docs/publishing/$page.png"
done
rm -rf "$PROFILE"
