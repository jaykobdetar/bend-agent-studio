"""Verified, local-only Minari HDF5 export. No environment execution or uploads."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import gymnasium as gym
import minari
from minari.data_collector import EpisodeBuffer
import numpy as np

MAX_OBSERVATION_BYTES = 65536


def read_json(text):
    return json.loads(text, parse_int=lambda s: -0.0 if s == "-0" else int(s),
                      parse_constant=lambda s: (_ for _ in ()).throw(ValueError("nonfinite JSON")))


def encode_observations(observations):
    # Scalars retain their numeric meaning. General JSON remains lossless,
    # including tagged Bend records and changing structures.
    if all(isinstance(o, (int, float)) and not isinstance(o, bool) for o in observations):
        if not all(math.isfinite(o) and abs(o) <= 2**53 for o in observations):
            raise ValueError("numeric observations must be finite safe JSON numbers")
        space = gym.spaces.Box(-np.inf, np.inf, shape=(), dtype=np.float64)
        return space, lambda xs: np.asarray(xs, dtype=np.float64), {"kind": "scalar-float64"}
    if len(observations) > 1_000_000:
        raise ValueError("at most one million observations per export")
    encoded = [json.dumps(o, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf8") for o in observations]
    width = max(map(len, encoded))
    if 2 * width * len(observations) > 128 * 1024 * 1024:
        raise ValueError("padded observation payload exceeds 128 MiB")
    if width > MAX_OBSERVATION_BYTES:
        raise ValueError("observation exceeds 64 KiB")
    # Prefix the UTF8 byte count, then zero-padded bytes. No dictionary or
    # opaque pickle and no assumptions about object/array schema.
    space = gym.spaces.Dict({
        "length": gym.spaces.Box(0, width, shape=(), dtype=np.int64),
        "utf8": gym.spaces.Box(0, 255, shape=(width,), dtype=np.uint16)})
    def encode(xs):
        bs = [json.dumps(o, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf8") for o in xs]
        values = np.zeros((len(bs), width), dtype=np.uint16)
        for i, b in enumerate(bs):
            values[i, :len(b)] = np.frombuffer(b, dtype=np.uint8)
        return {"length": np.asarray([len(b) for b in bs], dtype=np.int64), "utf8": values}
    return space, encode, {"kind": "json-utf8", "width": width}


def decode_observation(observation, codec):
    if codec["kind"] == "scalar-float64":
        return float(observation)
    return read_json(bytes(np.asarray(observation["utf8"][:int(observation["length"])], dtype=np.uint8)).decode("utf8"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def export(source, output, split="fit", dataset_id="bend-logged-v0", node="node"):
    source, output = Path(source).resolve(), Path(output).absolute()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,60}-v[0-9]+", dataset_id):
        raise ValueError("use a simple local dataset ID ending in -vN")
    if output.exists() or output.is_symlink():
        raise FileExistsError("output already exists")
    if split not in ("fit", "holdout", "all"):
        raise ValueError("split must be fit, holdout, or all")
    with tempfile.TemporaryDirectory(prefix="bend-minari-source-") as tmp:
        snapshot = Path(tmp) / "source"
        result = subprocess.run([node, str(Path(__file__).with_name("snapshot.mjs")), str(source), str(snapshot)],
                                capture_output=True, text=True, timeout=60, check=False)
        if result.returncode:
            raise ValueError("source verification failed: " + result.stderr[-2000:])
        design = read_json((snapshot / "design.json").read_text())
        index = read_json((snapshot / "dataset.json").read_text())
        episodes, provenance = [], []
        for part in index["body"]["parts"]:
            if split != "all" and part["split"] != split:
                continue
            rows = (snapshot / part["split"] / f'{part["rep"]}.jsonl').read_text().splitlines()
            for number, row in enumerate(rows):
                ep = read_json(row)
                if ep["reason"] not in ("Terminal", "Limit") or any(not f.get("accepted") for f in ep["frames"]):
                    raise ValueError("illegal/refused actions have no supported Minari transition")
                if not ep["frames"]:
                    raise ValueError("zero-transition episodes omit the initial observation; cannot export losslessly")
                rewards = np.asarray([f["reward"] for f in ep["frames"]], dtype=np.float64)
                if float(rewards.sum()) != ep["score"]:
                    raise ValueError("F32 source score differs from Minari reward sum; refusing to alter rewards or returns")
                episodes.append(ep)
                provenance.append({"split": part["split"], "rep": part["rep"], "line": number,
                                   "seed": ep["seed"], "score": ep["score"], "reason": ep["reason"],
                                   "sourceCheckpoint": part["sourceCheckpoint"], "partitionHash": part["hash"]})
        if not episodes:
            raise ValueError("selection has no episodes")
        observations = [[ep["frames"][0]["observation"]] + [f["nextObservation"] for f in ep["frames"]] for ep in episodes]
        space, encode, codec = encode_observations([o for xs in observations for o in xs])
        buffers = []
        for ep, obs in zip(episodes, observations):
            frames = ep["frames"]
            buffers.append(EpisodeBuffer(seed=ep["seed"], observations=encode(obs),
                actions=np.asarray([f["action"] for f in frames], dtype=np.int64),
                rewards=np.asarray([f["reward"] for f in frames], dtype=np.float64),
                terminations=np.asarray([f["terminal"] for f in frames], dtype=bool),
                truncations=np.asarray([f["truncated"] for f in frames], dtype=bool)))
        # mkdir is the no-clobber reservation. All writes go inside this new
        # directory, never to the user's default Minari registry.
        output.mkdir()
        previous = os.environ.get("MINARI_DATASETS_PATH")
        try:
            os.environ["MINARI_DATASETS_PATH"] = str(output / "datasets")
            minari.create_dataset_from_buffers(dataset_id=dataset_id, buffer=buffers,
                action_space=gym.spaces.Discrete(2**32), observation_space=space, data_format="hdf5",
                algorithm_name="Bend archived logging policy",
                description="Local verified Bend JSONL export. See provenance.json and source/.",
                requirements=["minari==0.5.3", "gymnasium==1.2.3"])
            reloaded = minari.load_dataset(dataset_id, download=False)
            require(reloaded.total_episodes == len(episodes), "reloaded episode count differs")
            require(reloaded.total_steps == sum(len(e["frames"]) for e in episodes), "reloaded step count differs")
            for saved, ep, obs in zip(reloaded.iterate_episodes(), episodes, observations):
                expected = encode(obs)
                if isinstance(expected, dict):
                    for key in expected:
                        require(np.array_equal(saved.observations[key], expected[key]), "reloaded observation field differs")
                else:
                    require(np.array_equal(saved.observations, expected), "reloaded observations differ")
                    require(np.array_equal(np.signbit(saved.observations), np.signbit(expected)), "reloaded observation signs differ")
                require(saved.rewards.tolist() == [f["reward"] for f in ep["frames"]], "reloaded rewards differ")
                require(float(saved.rewards.sum()) == ep["score"], "reloaded returns differ")
                require(saved.actions.tolist() == [f["action"] for f in ep["frames"]], "reloaded actions differ")
                require(saved.terminations.tolist() == [f["terminal"] for f in ep["frames"]], "reloaded terminations differ")
                require(saved.truncations.tolist() == [f["truncated"] for f in ep["frames"]], "reloaded truncations differ")
            retained = output / "source"
            retained.mkdir()
            # Preserve original seals without rewriting their contents or
            # including raw episodes from an unselected split.
            for name in ("design.json", "dataset.json"):
                shutil.copyfile(snapshot / name, retained / name)
            included_partitions, omitted_partitions = [], []
            for part in index["body"]["parts"]:
                name = f'{part["split"]}/{part["rep"]}.jsonl'
                entry = {"file": name, "hash": part["hash"]}
                if split == "all" or part["split"] == split:
                    (retained / part["split"]).mkdir(exist_ok=True)
                    shutil.copyfile(snapshot / name, retained / name)
                    included_partitions.append(entry)
                else:
                    omitted_partitions.append(entry)
            info = {"schema": 1, "dataset_id": dataset_id, "split": split, "observation_codec": codec,
                    "source_design_hash": design["hash"], "source_dataset_hash": index["hash"],
                    "episodes": provenance, "total_episodes": reloaded.total_episodes, "total_steps": reloaded.total_steps,
                    "format": "hdf5",
                    "source_retention": ("byte-for-byte verified full source collection" if split == "all"
                                         else "original seals plus byte-for-byte selected partitions only"),
                    "included_source_partitions": included_partitions,
                    "omitted_source_partitions": omitted_partitions,
                    "versions": {"minari": minari.__version__, "gymnasium": gym.__version__, "numpy": np.__version__}}
            (output / "provenance.json").write_text(json.dumps(info, indent=2) + "\n")
            return info
        except BaseException:
            shutil.rmtree(output)
            raise
        finally:
            if previous is None:
                os.environ.pop("MINARI_DATASETS_PATH", None)
            else:
                os.environ["MINARI_DATASETS_PATH"] = previous


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--split", choices=["fit", "holdout", "all"], default="fit")
    parser.add_argument("--dataset-id", default="bend-logged-v0")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    info = export(args.source, args.output, args.split, args.dataset_id, args.node)
    print(json.dumps({k: info[k] for k in ("dataset_id", "total_episodes", "total_steps")}))
