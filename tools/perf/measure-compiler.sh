#!/usr/bin/env bash
# A profiling-only compiler wrapper; preserve stdout, exit status and args.
set -eu
kind=compile
if [ "$#" -eq 1 ] && [ "$1" = version ]; then kind=version; fi
if [ "${2-}" = --check-only ]; then kind=check; fi
exec /usr/bin/time -a -o "$BEND_PERF_COMPILER_TIMES" -f "$kind %U %S %e %M" "$BEND_PERF_COMPILER" "$@"
