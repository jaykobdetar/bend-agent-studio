# Optional, local Minari export

This isolated integration exports verified Bend collected JSONL partitions into
an actual Minari 0.5.3 HDF5 dataset. It neither registers nor uploads anything,
executes no archived simulator, and never writes to the default Minari registry.

## Install and run

Use a new virtual environment, not the system interpreter:

```sh
python3 -m venv /tmp/bend-minari-venv
/tmp/bend-minari-venv/bin/python -m pip install -r integration/minari/requirements-lock.txt
/tmp/bend-minari-venv/bin/python integration/minari/export_minari.py COLLECTION NEW_OUTPUT --split fit --node /path/to/node
NODE=/path/to/node /tmp/bend-minari-venv/bin/python -m unittest discover -s integration/minari -v
```

Node is required for the repository's own canonical seal/checksum and trajectory
verification. Tested on Linux with Python 3.14.7, Node 24.22.3, Minari 0.5.3,
Gymnasium 1.2.3, h5py 3.15.1, NumPy 2.4.6 and Pillow 12.2.0. No Windows claim.
The direct requirements and the exact tested transitive lock are both included.
Pillow is needed by Minari's HDF5 backend even without image observations.

`--split fit` is the default; `holdout` and explicit `all` are available.
All original partitions, seals and logging masks/propensities are retained
byte-for-byte under `NEW_OUTPUT/source`. Keep that directory when sharing a
dataset, since those fields do not fit Minari's standard transition arrays.
The selected episode order follows the sealed partition index then line order.
`provenance.json` maps Minari episode order to split, replicate, source line,
seed, return, stop reason, checkpoint and partition hash. Source hashes identify
lineage, not a claim that the original simulator or run files are bundled.

Load locally without downloading:

```python
import os, minari
os.environ["MINARI_DATASETS_PATH"] = "/absolute/NEW_OUTPUT/datasets"
dataset = minari.load_dataset("bend-logged-v0", download=False)
for episode in dataset.iterate_episodes():
    print(episode.id, episode.rewards.sum())
```

The optional `--dataset-id` is a simple local name ending in `-vN`, not a remote
namespace. Existing outputs are rejected, even if empty. No environment spec
is fabricated: `recover_environment()` is not supported. Minari warns about the
missing simulator and author fields; these are deliberate, not missing uploads.

## Fidelity and unsupported cases

* Numeric scalar observations are exact float64 values for safe JSON numbers.
  Arbitrary structured/tagged observations use a reversible Gym Dict of UTF8
  JSON bytes plus length. Byte values use uint16 storage to prevent Minari 0.5.3
  from interpreting a uint8 matrix as an image and applying lossy JPEG. `decode_observation` restores them. This is explicit
  encoding, not a claim those bytes are directly useful policy features.
* Actions are full U32 IDs in a `Discrete(2**32)` space, without renumbering.
  Source legal-action ordering and propensities remain in the retained JSONL.
* Every episode has T actions/rewards/stop flags and T+1 observations.
  Terminal and truncated flags are copied independently without conflating them.
  The output is reloaded through real Minari and checked against source arrays.
* Illegal/refused-action episodes are rejected. The source collector itself
  excludes them; inventing a terminal transition would corrupt the data.
* Zero-transition episodes are rejected because collected JSONL omits their
  initial observation. Empty selections are rejected; no episode is dropped.
* Rewards are not modified. If their float64 NumPy sum differs from the sealed,
  sequential F32 episode score, export is rejected explicitly. For example,
  [16777216, 1, -16777216] has source score 0 but ordinary sum 1. Changing either
  the rewards or return to hide that distinction would not be lossless.
* This is an in-memory trusted-local utility, not a multi-tenant upload service.
  Sources are capped at 128 MiB total/64 MiB per file; linked partition directories
  and files are rejected. General encoded observations are capped at 64 KiB each
  and 128 MiB after padding. Node verification has a 60-second timeout.
  It is not hardened against a hostile user concurrently replacing filesystem
  paths, and the process-global Minari path means calls must not run in threads.

The fixture is real collection output: 24 Cliff episodes, 375 transitions.
Tests load actual Minari data and compare every observation/action/reward/stop
flag, returns and counts, plus corruption, no-overwrite, full-width action,
structured observation, illegal, zero-transition and F32-rounding edge cases.

Official API reference:
https://minari.farama.org/v0.5.3/api/minari_functions/
