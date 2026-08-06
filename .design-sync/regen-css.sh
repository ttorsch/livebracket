#!/usr/bin/env bash
# Regenerates components/livebracket-ds/tokens/_generated.sync.css — a flat
# concatenation of the real token files, used only as cfg.cssEntry for
# design-sync. See NOTES.md "Why _generated.sync.css exists" for why this
# can't just point at the real styles.css. Run before every re-sync build.
set -euo pipefail
cd "$(dirname "$0")/.."
DS=components/livebracket-ds
{
  cat "$DS/tokens/fonts.css"
  echo
  cat "$DS/tokens/colors.css"
  echo
  cat "$DS/tokens/typography.css"
  echo
  cat "$DS/tokens/spacing.css"
} > "$DS/tokens/_generated.sync.css"
echo "wrote $DS/tokens/_generated.sync.css"
