"""Exercise the real MLflow file store and compare curves with the plotter."""
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "analysis"))
from analyze import read_rows
from plot_curves import learning_curves

os.environ["MLFLOW_DISABLE_TELEMETRY"] = "true"
from mlflow.tracking import MlflowClient


class Export(unittest.TestCase):
    def node(self, *args):
        return subprocess.check_output(["node", str(ROOT / "experiment.mjs"), *map(str, args)],
                                       cwd=ROOT, encoding="utf-8")

    def exporter(self, archive, destination, *, check=True):
        return subprocess.run([sys.executable, str(HERE / "export_mlflow.py"),
                               str(archive), str(destination)], cwd=ROOT, capture_output=True,
                              encoding="utf-8", check=check, timeout=60)

    def test_real_file_tracking_and_plot_curve_parity(self):
        with tempfile.TemporaryDirectory() as tmp:
            temp = Path(tmp)
            manifest = temp / "bridge.json"
            plan = json.loads((ROOT / "experiments" / "bridge.json").read_text())
            plan["games"][0]["file"] = str(ROOT / "worlds" / "bridge.json")
            plan.update(replicates=3, checkpoints=[0, 2, 4], validationEpisodes=4, testEpisodes=4)
            manifest.write_text(json.dumps(plan))
            run = temp / "run"
            store = temp / "tracking"
            self.node("run", manifest, run, "--until", 2)
            rejected = self.exporter(run, store, check=False)
            self.assertEqual(rejected.returncode, 2, rejected.stderr)
            self.assertIn("missing checkpoint", rejected.stderr)
            self.assertFalse(store.exists())
            self.node("resume", run)
            sealed = json.loads((run / "run.json").read_text())
            metrics_csv = temp / "curves.csv"
            metrics_csv.write_text(self.node("export", run))

            result = json.loads(self.exporter(run, store).stdout)
            self.assertEqual(result, {"runs": 9, "run_hash": sealed["hash"]})
            self.assertFalse((store / ".bend-export-incomplete").exists())
            client = MlflowClient(tracking_uri=store.as_uri())
            experiment = client.get_experiment_by_name(plan["name"])
            runs = client.search_runs([experiment.experiment_id])
            self.assertEqual(len(runs), 9)
            pairs = {}
            for item in runs:
                tags = item.data.tags
                arm = tags["bend.arm"]
                rep = int(tags["bend.replicate"])
                pairs[arm, rep] = item
                self.assertEqual(tags["bend.game"], "bridge")
                self.assertEqual(tags["bend.run_hash"], sealed["hash"])
                self.assertEqual(tags["bend.backend_hash"], sealed["body"]["toolchain"]["backend"])
                self.assertEqual(tags["bend.version"], "bend 2.0.40")
                self.assertEqual(item.info.status, "FINISHED")
                self.assertEqual(json.loads(item.data.params["plan.checkpoints"]), [0, 2, 4])
                self.assertEqual(json.loads(item.data.params["arm.id"]), arm)
                self.assertEqual(item.data.params["replicate"], str(rep))

            rows = read_rows(metrics_csv)
            for phase, metric, reference in (("validation", "return", None),
                                              ("train", "reward_per_step", None),
                                              ("validation", "completion", "random"),
                                              ("test", "steps", None)):
                plotted = learning_curves(rows, phase, metric, reference, None, None, 500)
                for (_, arm), curve in plotted.items():
                    histories = []
                    for rep in range(3):
                        values = {x.step: x.value for x in client.get_metric_history(
                            pairs[arm, rep].info.run_id, f"{phase}.{metric}")}
                        if reference:
                            baseline = {x.step: x.value for x in client.get_metric_history(
                                pairs[reference, rep].info.run_id, f"{phase}.{metric}")}
                            self.assertEqual(values.keys(), baseline.keys())
                            values = {k: v - baseline[k] for k, v in values.items()}
                        self.assertEqual(sorted(values), [step for step, *_ in curve])
                        histories.append(values)
                    for step, mean, *_ in curve:
                        self.assertEqual(statistics.fmean(h[step] for h in histories), mean)

            duplicate = self.exporter(run, store, check=False)
            self.assertEqual(duplicate.returncode, 2)
            self.assertIn("already exists", duplicate.stderr)
            self.assertEqual(len(client.search_runs([experiment.experiment_id])), 9)
            manifest_file = run / "run.json"
            manifest_file.write_text(manifest_file.read_text().replace(sealed["hash"], "0" * 64))
            corrupted = self.exporter(run, temp / "corrupt-out", check=False)
            self.assertEqual(corrupted.returncode, 2)
            self.assertIn("checksum mismatch", corrupted.stderr)
            self.assertFalse((temp / "corrupt-out").exists())


if __name__ == "__main__":
    unittest.main()
