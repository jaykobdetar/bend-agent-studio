#!/usr/bin/env bash
# Download pinned, verified binary distributions locally; no sudo and no shell profile changes.
set -euo pipefail
umask 077

die() { printf 'setup: %s\n' "$*" >&2; exit 1; }
test_extras=0
if [ "${1:-}" = '--with-test-extras' ]; then
  test_extras=1
  shift
fi
[ "$#" -eq 0 ] || die 'usage: scripts/setup.sh [--with-test-extras]'
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
prefix="$root/.bend-setup"
mkdir -p "$prefix"
work=$(mktemp -d "$prefix/.install.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
python=${BEND_SETUP_PYTHON:-python3.12}
for command in curl tar zstd "$python"; do
  command -v "$command" >/dev/null || die "missing prerequisite: $command (see docs/testing.md)"
done
python=$(command -v "$python")
"$python" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))' ||
  die "expected Python 3.12; got $("$python" --version)"
if command -v sha256sum >/dev/null; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
else
  command -v shasum >/dev/null || die 'missing SHA-256 utility (sha256sum or shasum)'
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
fi

bend_version=2.0.40
node_version=24.22.3
lean_version=4.34.0
# SHA-256 pins from the official Bend/Lean release asset digests and Node SHASUMS256.txt.
case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    node_platform=linux-x64; lean_platform=linux
    bend_hash=c9ff8d67bd903fb6ad9a26b43d8a62c01021de82a44d55ce4a3dcd4732113d6b
    node_hash=061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2
    other_node_hash=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c
    lean_hash=caaa98356098c85dc0fcbbd28e1ec66f39eb6551829972b752ff20e1286b646b ;;
  Linux:aarch64|Linux:arm64)
    node_platform=linux-arm64; lean_platform=linux_aarch64
    bend_hash=2f42a6fa34ecdaa71ae105e5fa734f9a07e129d333e45448ab6d2ff03a837570
    node_hash=261af2af250dfd7e9f25cf151d1b2713a0adf8f10a9ad116c4947f68627affe8
    other_node_hash=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3
    lean_hash=40b04fdb7fb849d3c80e10c3bbeebc7b7354b6d3f07450b9168c2149b40d2a82 ;;
  Darwin:x86_64)
    node_platform=darwin-x64; lean_platform=darwin
    bend_hash=9229c8bdd0a93f63fa45cc5af5e9e56389ebb620d655920915daf966c6ca561c
    node_hash=977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7
    other_node_hash=d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035
    lean_hash=e90afe84c0a2aa3583f3ecd08e51fb7eeebb84d36f99b7cac5d3c067fa8640b0 ;;
  Darwin:arm64)
    node_platform=darwin-arm64; lean_platform=darwin_aarch64
    bend_hash=b2be003b041eb6cfc65326be18f79eb2e0bae2189be79a18c507e661b4b6900b
    node_hash=ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd
    other_node_hash=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7
    lean_hash=69f263fa6e21bbc2466bbfb1affcd92479ee2714c883a07de548e099a5922932 ;;
  *) die "unsupported platform: $(uname -s) $(uname -m)" ;;
esac

install_tool() {
  local url=$1 digest=$2 topdir=$3 dest=$4
  if [ ! -e "$dest" ]; then
    printf 'Downloading %s\n' "$url"
    curl --fail --silent --show-error --location --proto '=https' --retry 3 --connect-timeout 20 \
      -o "$work/archive" "$url"
    [ "$(sha256 "$work/archive")" = "$digest" ] || die "SHA-256 mismatch for $url"
    case "$url" in
      *.tar.gz) tar -xzf "$work/archive" -C "$work" ;;
      *.tar.zst) zstd -dc "$work/archive" | tar -xf - -C "$work" ;;
      *) die "unsupported archive: $url" ;;
    esac
    [ -d "$work/$topdir/bin" ] || die "missing $topdir/bin in $url"
    mv -- "$work/$topdir" "$dest"
  fi
}

bend_dir="$prefix/bend-$bend_version-$node_platform"
node_archive="node-v$node_version-$node_platform"
node_dir="$prefix/$node_archive"
lean_archive="lean-$lean_version-$lean_platform"
lean_dir="$prefix/$lean_archive"
install_tool "https://github.com/bendlang/bend/releases/download/v$bend_version/bend-$bend_version-$node_platform.tar.gz" \
  "$bend_hash" bend "$bend_dir"
install_tool "https://nodejs.org/dist/v$node_version/$node_archive.tar.gz" \
  "$node_hash" "$node_archive" "$node_dir"
install_tool "https://github.com/leanprover/lean4/releases/download/v$lean_version/$lean_archive.tar.zst" \
  "$lean_hash" "$lean_archive" "$lean_dir"

bins="$node_dir/bin:$bend_dir/bin:$lean_dir/bin"
export PATH="$bins:$PATH"
export BEND_NO_TELEMETRY=1
# Use absolute paths for checks; never accidentally accept another installation.
bend_actual=$("$bend_dir/bin/bend" version) || die 'installed Bend does not run'
node_actual=$("$node_dir/bin/node" --version) || die 'installed Node does not run'
lean_actual=$("$lean_dir/bin/lean" --version) || die 'installed Lean does not run'
[ "$bend_actual" = "bend $bend_version" ] || die "expected bend $bend_version, got $bend_actual"
[ "$node_actual" = "v$node_version" ] || die "expected Node v$node_version, got $node_actual"
case "$lean_actual" in
  "Lean (version $lean_version,"*) ;;
  *) die "expected Lean $lean_version, got $lean_actual" ;;
esac

setup_venv() {
  local lockfile=$2 venv="$prefix/$1"
  if [ ! -x "$venv/bin/python" ]; then
    "$python" -m venv "$venv" || die "could not create $1 environment (is Python venv installed?)"
  fi
  "$venv/bin/python" -m pip --disable-pip-version-check --no-input install --only-binary=:all: -r "$lockfile"
  "$venv/bin/python" -m pip --disable-pip-version-check check
  "$venv/bin/python" - "$lockfile" <<'PY'
from importlib.metadata import version
from pathlib import Path
import sys

if sys.version_info[:2] != (3, 12):
    raise SystemExit(f"Expected Python 3.12, got {sys.version}")
for raw in Path(sys.argv[1]).read_text().splitlines():
    line = raw.split("#", 1)[0].strip()
    if line:
        name, expected = line.split("==")
        got = version(name)
        if got != expected:
            raise SystemExit(f"{name}: expected {expected}, got {got}")
        print(f"{name}=={got}")
PY
}
setup_venv gymnasium integrations/gymnasium/requirements.txt
setup_venv minari integrations/minari/requirements-lock.txt
if [ "$test_extras" -eq 1 ]; then
  # Required only for the historical cross-version MCP fixture.
  other_version=24.22.1
  other_archive="node-v$other_version-$node_platform"
  other_dir="$prefix/$other_archive"
  install_tool "https://nodejs.org/dist/v$other_version/$other_archive.tar.gz" \
    "$other_node_hash" "$other_archive" "$other_dir"
  other_actual=$("$other_dir/bin/node" --version) || die 'installed archive-test Node does not run'
  [ "$other_actual" = "v$other_version" ] || die "expected archive-test Node v$other_version, got $other_actual"
  printf 'Archive-test Node %s\n' "$other_actual"
  setup_venv mcp-test mcp/requirements-test-lock.txt
fi
(cd mcp && npm ci --ignore-scripts)

{
  printf 'export PATH=%q:"$PATH"\n' "$bins"
  printf 'export BEND_NO_TELEMETRY=1\n'
  printf 'export BEND_GYM_PYTHON=%q\n' "$prefix/gymnasium/bin/python"
  printf 'export BEND_MINARI_PYTHON=%q\n' "$prefix/minari/bin/python"
  if [ "$test_extras" -eq 1 ]; then
    printf 'export BEND_MCP_TEST_OTHER_NODE=%q\n' "$other_dir/bin/node"
    printf 'export BEND_MCP_TEST_PYTHON=%q\n' "$prefix/mcp-test/bin/python"
  fi
} > "$work/env.sh"
mv -- "$work/env.sh" "$prefix/env.sh"
printf '%s\nNode %s\n%s\nnpm %s\n%s\n' \
  "$bend_actual" "$node_actual" "$lean_actual" "$(npm --version)" "$("$python" --version)"
printf 'Setup complete. Activate this checkout with: source %q\n' "$prefix/env.sh"
