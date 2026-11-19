import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import minari
import numpy as np
from export_minari import export, decode_observation, encode_observations

HERE = Path(__file__).resolve().parent
NODE = os.environ.get("NODE", "node")


class ExportTests(unittest.TestCase):
    def test_real_collected_dataset_and_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "export"
            info = export(HERE / "fixtures/cliff", out, "all", node=NODE)
            self.assertEqual(info["total_episodes"], 24)
            self.assertEqual(info["total_steps"], 375)
            self.assertEqual(info["omitted_source_partitions"], [])
            self.assertEqual(len(info["included_source_partitions"]), 8)
            old = os.environ.get("MINARI_DATASETS_PATH")
            try:
                os.environ["MINARI_DATASETS_PATH"] = str(out / "datasets")
                ds = minari.load_dataset(info["dataset_id"], download=False)
                for saved, meta in zip(ds.iterate_episodes(), info["episodes"]):
                    source = HERE / "fixtures/cliff" / meta["split"] / f'{meta["rep"]}.jsonl'
                    original = json.loads(source.read_text().splitlines()[meta["line"]])
                    frames = original["frames"]
                    self.assertEqual(saved.rewards.sum(), original["score"])
                    self.assertEqual(saved.rewards.tolist(), [f["reward"] for f in frames])
                    self.assertEqual(saved.actions.tolist(), [f["action"] for f in frames])
                    self.assertEqual(saved.observations.tolist(), [frames[0]["observation"]] + [f["nextObservation"] for f in frames])
                    self.assertEqual(saved.terminations.tolist(), [f["terminal"] for f in frames])
                    self.assertEqual(saved.truncations.tolist(), [f["truncated"] for f in frames])
                for file in (HERE / "fixtures/cliff").rglob("*"):
                    if file.is_file():
                        self.assertEqual(file.read_bytes(), (out / "source" / file.relative_to(HERE / "fixtures/cliff")).read_bytes())
                with self.assertRaises(FileExistsError):
                    export(HERE / "fixtures/cliff", out, node=NODE)
                self.assertEqual(ds.total_episodes, 24)
            finally:
                if old is None: os.environ.pop("MINARI_DATASETS_PATH", None)
                else: os.environ["MINARI_DATASETS_PATH"] = old

    def test_selected_split_retains_no_other_split_raw_rows(self):
        for split, excluded, count in [("fit", "holdout", 16), ("holdout", "fit", 8)]:
            with self.subTest(split=split), tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / "export"
                # Exercise the default fit path as well as explicit holdout.
                args = {} if split == "fit" else {"split": split}
                info = export(HERE / "fixtures/cliff", out, node=NODE, **args)
                self.assertEqual(info["total_episodes"], count)
                self.assertEqual({e["split"] for e in info["episodes"]}, {split})
                self.assertFalse((out / "source" / excluded).exists())
                retained = {p.relative_to(out / "source").as_posix()
                            for p in (out / "source").rglob("*.jsonl")}
                expected = {f"{split}/{i}.jsonl" for i in range(4)}
                self.assertEqual(retained, expected)
                self.assertEqual({p["file"] for p in info["included_source_partitions"]}, expected)
                self.assertEqual({p["file"] for p in info["omitted_source_partitions"]},
                                 {f"{excluded}/{i}.jsonl" for i in range(4)})
                for name in ["design.json", "dataset.json", *sorted(expected)]:
                    self.assertEqual((out / "source" / name).read_bytes(),
                                     (HERE / "fixtures/cliff" / name).read_bytes())

    def test_invalid_checksum_and_path_never_create_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"
            shutil.copytree(HERE / "fixtures/cliff", source)
            (source / "fit/0.jsonl").write_text("{}\n")
            out = Path(tmp) / "out"
            with self.assertRaisesRegex(ValueError, "verification"):
                export(source, out, node=NODE)
            self.assertFalse(out.exists())
            with self.assertRaises(ValueError):
                export(source, out, dataset_id="../bad-v0", node=NODE)

    def fixture(self, tmp, mode):
        # Produce correctly sealed edge fixtures using the repository's exact
        # canonicalization, so failures exercise semantic rather than hash checks.
        script = r"""
import fs from 'node:fs';import path from 'node:path';
import {seal} from './core/experiment.mjs';import {canonical,digest} from './core/experiment_config.mjs';
const [out,mode]=process.argv.slice(1);fs.mkdirSync(out);
let frames=[];
if(mode!=='zero') {
 const rewards=mode==='rounding'?[16777216,1,-16777216]:[1];
 frames=rewards.map((r,i)=>({observation:mode==='json'?{$:'Point',x:i,list:[true,'a']}:i,legal:[4294967295],action:4294967295,accepted:true,reward:r,
 nextObservation:mode==='json'?{$:'Point',x:i+1,list:[true,'a']}:i+1,nextLegal:i===rewards.length-1?[]:[4294967295],
 preferred:4294967295,propensityBuckets:65536,terminal:i===rewards.length-1,truncated:false}));
}
const spec={fitEpisodes:1,holdoutEpisodes:1,seeds:{fit:7,holdout:9,stride:1},epsilon:0};
const design=seal({schema:1,spec,replicates:1,horizon:frames.length});fs.writeFileSync(path.join(out,'design.json'),design);
const parts=['fit','holdout'].map(split=>{
 fs.mkdirSync(path.join(out,split));const score=mode==='rounding'||mode==='zero'?0:1;
 const bytes=canonical({seed:spec.seeds[split],score,reason:mode==='illegal'?'Illegal':'Terminal',frames})+'\n';
 fs.writeFileSync(path.join(out,split,'0.jsonl'),bytes);
 return {split,rep:0,file:split+'/0.jsonl',episodes:1,steps:frames.length,sourceCheckpoint:'fixture',hash:digest(bytes)};
});
fs.writeFileSync(path.join(out,'dataset.json'),seal({design:JSON.parse(design).hash,parts}));
"""
        source = Path(tmp) / mode
        subprocess.run([NODE, "--input-type=module", "-e", script, str(source), mode],
                       cwd=HERE.parent.parent, check=True, capture_output=True, timeout=20)
        return source

    def test_zero_illegal_and_return_rounding_rejected(self):
        for mode, message in [("zero", "zero-transition"), ("illegal", "verification"), ("rounding", "reward sum")]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                source = self.fixture(tmp, mode)
                out = Path(tmp) / "out"
                with self.assertRaisesRegex(ValueError, message):
                    export(source, out, node=NODE)
                self.assertFalse(out.exists())

    def test_tagged_json_and_full_width_actions_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = self.fixture(tmp, "json")
            out = Path(tmp) / "out"
            info = export(source, out, node=NODE)
            old = os.environ.get("MINARI_DATASETS_PATH")
            os.environ["MINARI_DATASETS_PATH"] = str(out / "datasets")
            try:
                ds = minari.load_dataset(info["dataset_id"], download=False)
                ep = next(ds.iterate_episodes())
                self.assertEqual(ep.actions.tolist(), [4294967295])
                for i in range(2):
                    obs = {k: v[i] for k, v in ep.observations.items()}
                    self.assertEqual(decode_observation(obs, info["observation_codec"]), {"$": "Point", "x": i, "list": [True, "a"]})
            finally:
                if old is None: os.environ.pop("MINARI_DATASETS_PATH", None)
                else: os.environ["MINARI_DATASETS_PATH"] = old


if __name__ == "__main__":
    unittest.main()
