#!/usr/bin/env bash
# Verify the test-ready environment created by scripts/setup.sh --with-test-extras.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source .venv/bend-studio/env.sh
if [ ! -x "${BEND_MCP_TEST_PYTHON:-}" ] || [ ! -x "${BEND_MCP_TEST_OTHER_NODE:-}" ]; then
  echo 'Run scripts/setup.sh --with-test-extras before checking setup.' >&2
  exit 1
fi

logs=$(mktemp -d "${TMPDIR:-/tmp}/bend-setup-tests.XXXXXXXX")
trap 'rm -rf -- "$logs"' EXIT
export NODE_OPTIONS=--test-reporter=tap
npm test | tee "$logs/root.tap"
PATH="$(dirname "$BEND_MCP_TEST_PYTHON"):$PATH" npm --prefix mcp test | tee "$logs/mcp.tap"

require_zero_skips() {
  if ! awk -v expected="$2" '
    /^# skipped [0-9]+$/ { summaries++; skipped += $3 }
    END { exit !(summaries == expected && skipped == 0) }
  ' "$1"; then
    echo "Expected $2 zero-skip test summaries in $1" >&2
    return 1
  fi
}
require_zero_skips "$logs/root.tap" 3
require_zero_skips "$logs/mcp.tap" 1
(cd integrations/gymnasium && "$BEND_GYM_PYTHON" -m unittest -v)
"$BEND_MINARI_PYTHON" -m unittest discover -s integrations/minari -v
