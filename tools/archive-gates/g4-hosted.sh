#!/usr/bin/env bash
# Hosted Linux: existing checks.yml Node 24.22.3, verified Bend 2.0.40 and MCP dependencies.
# Run from candidate checkout with full history. Pass absolute path to g4-hosted.mjs.
set -eu
test "$(node -p process.versions.node)" = 24.22.3
test "$(bend version)" = 'bend 2.0.40'
repo=$PWD; scratch=$(mktemp -d); old=$scratch/old; runs=$scratch/runs
mkdir "$old" "$runs"
git archive dd4c5439a241d6b4ebefa6f73a16875907686977 | tar -x -C "$old"
for pair in 'bridge bridge' 'custom cliff-sarsa'; do
 read -r name plan <<< "$pair"; run=$runs/$name
 node "$old/experiment.mjs" run "$old/experiments/$plan.json" "$run" --until 32
 node "$repo/experiment.mjs" status "$run"
 node "$run/code/experiment.mjs" rerun "$run" "$scratch/$name-control"
done
node "$1" "$repo" "$runs"
for name in bridge custom; do
 run=$runs/$name
 node "$run/code/experiment.mjs" resume "$run"
 node "$repo/experiment.mjs" verify "$run"
 node "$repo/experiment.mjs" export "$run" > "$scratch/$name.csv"
 node "$old/experiment.mjs" export "$scratch/$name-control" > "$scratch/$name-control.csv"
 cmp "$scratch/$name.csv" "$scratch/$name-control.csv"
 diff -qr "$run/trials" "$scratch/$name-control/trials"
done
