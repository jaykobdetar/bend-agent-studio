"""Check an existing, single-child CUDA diagnostic capture; never run the GPU."""

import json
from pathlib import Path
import sqlite3
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: check-kernel.py EXPORTED_TRACE")
try:
    uri = Path(sys.argv[1]).resolve(strict=True).as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as db:
        names = {
            name
            for (name,) in db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name IN ('CUPTI_ACTIVITY_KIND_KERNEL', 'StringIds')"
            )
        }
        missing = {"CUPTI_ACTIVITY_KIND_KERNEL", "StringIds"} - names
        if missing:
            absent = ", ".join(sorted(missing))
            raise SystemExit(f"capture cannot verify bend_dev: missing table(s) {absent}")
        results = db.execute(
            """
            SELECT k.globalPid, k.deviceId, count(*)
            FROM CUPTI_ACTIVITY_KIND_KERNEL AS k JOIN StringIds AS s
              ON k.demangledName = s.id
            WHERE s.value = 'bend_dev' AND k.end > k.start
            GROUP BY k.globalPid, k.deviceId
            """
        ).fetchall()
except (OSError, sqlite3.Error):
    raise SystemExit("capture cannot verify bend_dev: unreadable or unsupported SQLite export")
if len(results) != 1 or results[0][0] is None or results[0][2] < 1:
    raise SystemExit("capture does not verify timed bend_dev activity from one child on one GPU")
pid, device, count = results[0]
print(json.dumps({"kernel": "bend_dev", "tracePid": pid, "device": device, "launches": count}))
