#!/usr/bin/env bash
# Only after a separately authorized exclusive slot; see README.
set -euo pipefail
if [[ ${P118_EXCLUSIVE_SLOT:-} != confirmed || $# != 5 ||
      ! ${P118_CPUS:-} =~ ^[0-9]+,[0-9]+,[0-9]+,[0-9]+$ ]]; then
  echo 'requires exclusive-slot approval and P118_CPUS=a,b,c,d (four distinct physical cores)' >&2
  echo 'usage: run-authorized.sh STOCK_RUN O3_DIR NEW_EVIDENCE P110_GUARD CLANG' >&2
  exit 2
fi
bench=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
root=$(realpath "$bench/../../..")
archive=$(realpath -e "$1")
o3=$(realpath -e "$2")
out=$(realpath -m "$3")
guard=$(realpath -e "$4")
clang=$(realpath -e "$5")
test ! -e "$out"
IFS=, read -r -a cpus <<< "$P118_CPUS"
declare -A seen_cores=()
for cpu in "${cpus[@]}"; do
  siblings=$(< "/sys/devices/system/cpu/cpu$cpu/topology/thread_siblings_list")
  test -n "$siblings"
  if [[ -v "seen_cores[$siblings]" ]]; then
    echo "P118_CPUS selects more than one logical CPU on physical core $siblings" >&2
    exit 2
  fi
  seen_cores["$siblings"]=1
  printf 'Reserve physical core with siblings %s; measured logical CPU %s\n' "$siblings" "$cpu" >&2
done
cpu1=${cpus[0]}
test "$(node --version)" = v24.22.3
test "$(bend version)" = 'bend 2.0.40'
case "$("$clang" --version)" in 'clang version 22.1.4 '*) ;; *) exit 2;; esac
test "$(awk '/MemAvailable:/{print $2}' /proc/meminfo)" -ge 5242880
test "$(df -Pk "$(dirname "$out")" | awk 'NR==2{print $4}')" -ge 25165824
export C_INCLUDE_PATH="${clang%/bin/clang}/include/clang"
export NODE_DISABLE_COMPILE_CACHE=1 BEND_NO_TELEMETRY=1
unset CUDA_HOME CUDA_PATH
# Use the established P11.0 per-user lock without reopening a lock pathname.
if [[ -z ${P118_LOCK_FD:-} ]]; then
  exec python3 - "$bench/run-authorized.sh" "$@" <<'PY'
import fcntl, os, sys
p = '/tmp/bend-perf-' + str(os.getuid()) + '.lock'
fd = os.open(p, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.set_inheritable(fd, True)
os.environ['P118_LOCK_FD'] = str(fd)
os.execvp('bash', ['bash', *sys.argv[1:]])
PY
fi
test "$(readlink "/proc/$$/fd/$P118_LOCK_FD")" = "/tmp/bend-perf-$(id -u).lock"
mkdir "$out"
mkdir "$out"/{tmp,cache}
export TMPDIR="$out/tmp" XDG_CACHE_HOME="$out/cache"
cd "$root"
probe="$bench/stock-in-memory.mjs"
spike="$bench/../parity.mjs"
bin="$o3/dry-lake-x86-64-v3"
src="$o3/dry-lake.c"
locked=$(jq -r '.timedArchitecture' "$bench/workload.json")
hash() { sha256sum "$1" | cut -d' ' -f1; }
check_hash() { test "$(hash "$2")" = "$1"; }
test "$locked" = x86-64-v3
binaryHash=$(jq -r '.primary.targets["x86-64-v3"].binarySha256' "$bench/o3-gate.json")
wireHash=$(jq -r '.primary.targets["x86-64-v3"].wireSha256' "$bench/o3-gate.json")
sourceHash=$(jq -r '.primary.sourceSha256' "$bench/o3-gate.json")
stockHash=$(jq -r .backend "$bench/workload.json")
check_hash "$binaryHash" "$bin"
check_hash "$sourceHash" "$src"
check_hash "$(jq -r .worldSha256 "$bench/workload.json")" "$(jq -r .worldFile "$bench/workload.json")"

sample() {
  local key=$1 mask=$2; shift 2
  python3 "$guard" --cpu "$cpu1" --seconds 90 --mib 2048 --min-available-mib 5120 \
    --stdout "$out/$key.out" --stderr "$out/$key.err" --metric "$out/$key.json" \
    --stop-file "$out/STOP" -- taskset -c "$mask" "$@"
  jq -e '.returncode == 0 and .capReason == null' "$out/$key.json" >/dev/null
}
matched() { grep -Fx '27 complete checkpoint files matched the stock archived bytes. No native archive written.' "$out/$1.out" >/dev/null; }
sample setup-lock "$cpu1" node "$probe" --lock "$archive"
for workers in 1 2 4; do
  sample "setup-stock-$workers" "$cpu1" node "$probe" --verify "$archive" "$workers"
  matched "setup-stock-$workers"
done

native_flags=(-std=c11 -O3 -Wall -Wextra -Werror -march=x86-64-v3 -ffp-contract=off -fno-fast-math -pthread)
stock_cold() {
  local round=$1
  sample "round$round-stock-stage-not-timed" "$cpu1" node "$probe" --stage "$archive" "$out/r$round-staged"
  sample "round$round-stock-compile" "$cpu1" bend "$out/r$round-staged/study.bend" -o "$out/r$round-staged/study.mjs"
  check_hash "$stockHash" "$out/r$round-staged/study.mjs"
  sample "round$round-stock-preparation" "$cpu1" bash -c \
    'node "$1" --stage "$2" "$3" && bend "$3/study.bend" -o "$4"' -- \
    "$probe" "$archive" "$out/r$round-reprepared" "$out/r$round-reprepared/study.mjs"
  check_hash "$stockHash" "$out/r$round-reprepared/study.mjs"
}
native_cold() {
  local round=$1 fresh="$out/r$1-native-src"
  mkdir "$fresh"
  sample "round$round-native-compile" "$cpu1" "$clang" "${native_flags[@]}" "$src" -lm -o "$out/r$round-native"
  check_hash "$binaryHash" "$out/r$round-native"
  sample "round$round-native-preparation" "$cpu1" bash -c \
    'node "$1" generate "$2" "$3" && compiler=$4 && output=$5 && source=$3 && shift 5 && "$compiler" "$@" "$source" -lm -o "$output"' -- \
    "$spike" "$archive" "$fresh/dry-lake.c" "$clang" "$fresh/dry-lake-x86-64-v3" "${native_flags[@]}"
  check_hash "$sourceHash" "$fresh/dry-lake.c"
  check_hash "$binaryHash" "$fresh/dry-lake-x86-64-v3"
}
raw() {
  sample "$label-raw" "$mask" "$bin" "$workers"
  check_hash "$wireHash" "$out/$label-raw.out"
}
stock() {
  sample "$label-stock" "$mask" node "$probe" --verify "$archive" "$workers"
  matched "$label-stock"
}
native() {
  sample "$label-native" "$mask" node "$spike" check "$archive" "$bin" "$workers"
  matched "$label-native"
}
for round in {1..5}; do
  if (( round % 2 )); then stock_cold "$round"; native_cold "$round";
  else native_cold "$round"; stock_cold "$round"; fi
  for workers in $(jq -r ".roundOrders[$((round-1))] | .[]" "$bench/workload.json"); do
    case "$workers" in 1) mask=$cpu1;; 2) mask=$cpu1,${cpus[1]};; 4) mask=$P118_CPUS;; *) exit 2;; esac
    label=round$round-$workers
    if (( round % 2 )); then raw; stock; native; else native; stock; raw; fi
  done
done
printf 'Completed all five preregistered rounds. Report diagnostic layers separately.\n'
