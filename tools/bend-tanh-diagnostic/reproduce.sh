#!/usr/bin/env bash
# Explicit opt-in local CPU diagnostic. No installs, GPU, or repository writes.
set -euo pipefail
umask 077
src=$(cd -- "$(dirname -- "$0")" && pwd)
if [[ $# != 2 || ! $1 =~ ^(js|native)$ ]]; then
  printf 'usage: %s js|native OUTPUT_DIRECTORY\n' "$0" >&2
  exit 2
fi
mode=$1
out=$(realpath -m -- "$2")
hashcheck() { printf '%s  %s\n' "$1" "$2" | sha256sum -c -; }

word_sha=a7215fc26468e629a0c072e9520faba7ffe32efec6d3236e8d493b995cc633d9
bend_sha=b7464e0489b67a5b812d5f0e76ad23db2b6cdcb14086db6dca9ff413d0bd620c
ref_sha=be810bd7ad3cc5bc955da6406c6070f23fad82a18d80e97237293bd06c636b27
result_sha=24858da8dcc678202592e2f3adc2ccca1af20e92709283850ce11b4c3c0aea9a

test "$(bend version)" = 'bend 2.0.40'
export BEND_NO_TELEMETRY=1 BENDRTS= CUDA_VISIBLE_DEVICES=
if [[ "$mode" == js ]]; then
  test "$(node --version)" = 'v24.22.3'
  mkdir "$out" "$out/tmp"
  export TMPDIR="$out/tmp"
  python3 "$src/corpus.py" > "$out/words.txt"
  hashcheck "$word_sha" "$out/words.txt"
  flags=(-std=c11 -O2 -Wall -Wextra -Werror -fno-fast-math -ffp-contract=off)
  gcc "${flags[@]}" "$src/directed-interval.c" -lmpfr -lm -o "$out/mpfr-interval"
  gcc "${flags[@]}" "$src/target-format.c" -lmpfr -lgmp -o "$out/mpfr-target"
  "$out/mpfr-interval" < "$out/words.txt" > "$out/interval.txt" 2> "$out/interval.log"
  "$out/mpfr-target" < "$out/words.txt" > "$out/target.txt" 2> "$out/target.log"
  grep -Fqx 'MPFR 4.2.1' "$out/interval.log"
  grep -Fqx 'MPFR 4.2.1, precision 24, emin -148, emax 128' "$out/target.log"
  hashcheck "$ref_sha" "$out/interval.txt"
  hashcheck "$ref_sha" "$out/target.txt"
  python3 "$src/generate.py" > "$out/tanh_portable.bend"
  hashcheck "$bend_sha" "$out/tanh_portable.bend"
  bend "$out/tanh_portable.bend" --check-only
  bend "$out/tanh_portable.bend" -o "$out/tanh_portable.mjs"
  node "$src/check.mjs" "$out/tanh_portable.mjs" "$out" "$out" | tee "$out/js-summary.json"
  hashcheck "$result_sha" "$out/witness.txt"
else
  hashcheck "$word_sha" "$out/words.txt"
  hashcheck "$bend_sha" "$out/tanh_portable.bend"
  hashcheck "$result_sha" "$out/witness.txt"
  mkdir "$out/native" "$out/native/tmp"
  export TMPDIR="$out/native/tmp"
  clang_path=$(realpath "$(command -v clang)")
  "$clang_path" --version > "$out/native/clang.txt"
  grep -q '^clang version 22\.1\.4 ' "$out/native/clang.txt"
  # Some clang distributions keep resource headers at include/clang.
  clang_root=$(dirname "$(dirname "$clang_path")")
  native_env=()
  if [[ -f "$clang_root/include/clang/stdbool.h" ]]; then
    native_env+=("C_INCLUDE_PATH=$clang_root/include/clang")
  fi
  cat "$out/tanh_portable.bend" "$src/native-driver.bend" > "$out/native/tanh_native.bend"
  hashcheck ce0d0c612f4b6d403b6ae7b467779f1c596bfc62cb655e08828fe14beb049bfd "$out/native/tanh_native.bend"
  bend "$out/native/tanh_native.bend" --check-only
  env -u CUDA_HOME -u CUDA_PATH CC="$clang_path" "${native_env[@]}" \
    bend "$out/native/tanh_native.bend" -o "$out/native/tanh_native"
  mapfile -t words < <(python3 -c 'from pathlib import Path; import sys; print(*[int(x,16) for x in Path(sys.argv[1]).read_text().splitlines()],sep="\n")' "$out/words.txt")
  test "${#words[@]}" = 5692
  "$out/native/tanh_native" +RTS --threads 1 --gpu off -RTS "${words[@]}" > "$out/native/witness.txt"
  cmp "$out/witness.txt" "$out/native/witness.txt"
  hashcheck "$result_sha" "$out/native/witness.txt"
fi
