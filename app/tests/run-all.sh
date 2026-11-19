#!/usr/bin/env bash
# tests/run-all.sh — TEST ONLY. Runs the unit tests and every browser test file.
# Needs Node 18+, Python 3 with Playwright, and Chrome (SCP_CHROME to override the path).
set -u
cd "$(dirname "$0")"
fail=0
node test-calc.js || fail=1
for f in ui_epic_*.py; do
  echo; echo "== $f"
  python3 "$f" || fail=1
done
exit $fail
