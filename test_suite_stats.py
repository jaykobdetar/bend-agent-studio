"""Regression checks for the optional fixed-suite analyzer; no third-party imports."""
import csv
import io
import itertools
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from suite_stats import bootstrap, estimate, iqm, superiority


class Metrics(unittest.TestCase):
    def test_trim_convention_and_ties(self):
        self.assertEqual(iqm([0, 0, 1, 10, 100]), 11 / 3)
        for x in itertools.product(range(3), repeat=3):
            for y in itertools.product(range(3), repeat=3):
                expected = sum((a > b) + .5 * (a == b) for a in x for b in y) / 9
                self.assertAlmostEqual(superiority(x, y), expected)
        self.assertEqual(superiority([0, 10], [1, 11]), .25)  # matched win-rate would be zero

    def test_stratified_bootstrap_reuses_paired_ids(self):
        x = [[1, 2, 9, 21], [50, 70, 80, 91]]
        y = [[v - 7 for v in task] for task in x]
        for scheme in ["within-game", "across-games"]:
            self.assertEqual(bootstrap(x, y, "iqm", None, scheme, 150, "example"), (7., 7.))
        # Across-game replicate effects cancel only under the declared joint block design.
        panel = [[0, 0, 10, 10], [10, 10, 0, 0]]
        self.assertEqual(bootstrap(panel, None, "iqm", None, "across-games", 300, "z"), (5., 5.))
        self.assertNotEqual(bootstrap(panel, None, "iqm", None, "within-game", 300, "z"), (5., 5.))
        self.assertEqual(bootstrap([[3]], None, "iqm", None, "within-game", 150, "z"), ("", ""))
        self.assertEqual(estimate([[0, 1], [1, 2]], None, "profile", 1), .25)


class CLI(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.file = self.root / "assessment.csv"
        self.rows = []
        for game in ["a", "b"]:
            for i in range(4):
                for arm in ["x", "ref"]:
                    score = 2*i + int(arm == "x")
                    self.rows.append({"source_checkpoint": "x", "target":game, "comparison":arm,
                                      "replicate":i,"seed":i+100,"episodes":1,"sum":score,
                                      "steps":4,"terminal":1,"limited":0,"illegal":0})
        self.save()

    def save(self):
        with self.file.open("w", newline="") as f:
            w = csv.DictWriter(f, self.rows[0].keys())
            w.writeheader()
            w.writerows(self.rows)

    def call(self, *args, ok=True):
        p = subprocess.run([sys.executable, str(Path(__file__).with_name("analyze.py")), str(self.file),
                            "--draws", "100", *args], text=True, capture_output=True)
        if not ok:
            self.assertNotEqual(p.returncode, 0)
            return p.stderr
        self.assertEqual(p.returncode, 0, p.stderr)
        return list(csv.DictReader(io.StringIO(p.stdout)))

    def test_default_csv_and_new_modes(self):
        rows = self.call("--reference", "ref")
        self.assertEqual(set(rows[0]), {"game","budget","arm","reference","phase","metric","replicates",
                                        "estimate","ci_low","ci_high","replicate_sd"})
        self.assertEqual([float(x["estimate"]) for x in rows], [1., 1.])
        opts = ("--aggregate", "probability-of-improvement", "--reference", "ref")
        p, = self.call(*opts)
        self.assertEqual(float(p["estimate"]), .625)
        self.rows.reverse()
        self.save()
        self.assertEqual(self.call(*opts), [p])   # deterministic and invariant to source row order
        self.assertIn("comparable", self.call("--aggregate", "iqm", ok=False))
        a = self.root / "anchors.json"
        a.write_text(json.dumps({"a":[0,10], "b":[0,10]}))
        q, = self.call("--aggregate","iqm","--reference","ref","--anchors",str(a))
        self.assertAlmostEqual(float(q["estimate"]), .1)
        self.assertAlmostEqual(float(q["ci_low"]), .1)
        self.assertAlmostEqual(float(q["ci_high"]), .1)
        with self.subTest("reverse endpoint"):
            low, = self.call(*opts, "--direction","lower")
            self.assertAlmostEqual(float(low["estimate"]), 1-float(p["estimate"]))

    def test_study_phases_and_incompatible_budget_units(self):
        self.rows = []
        for g in ["a", "b"]:
            for rep in range(2):
                for arm in ["x", "ref"]:
                    for budget in [0, 2]:
                        row = dict(game=g, arm=arm, replicate=rep, budget=budget, budget_unit="episodes",
                                   trained_episodes=budget, partial_steps=0, interaction_steps=budget)
                        for phase in ["train", "validation", "test"]:
                            count = budget if phase == "train" else 2
                            for key, v in dict(episodes=count, terminal=count, limited=0, illegal=0,
                                               sum=count*(rep+int(arm=="x")), steps=count).items():
                                row[phase+"_"+key] = "" if phase=="test" and not budget else v
                            row[phase+"_seed"] = rep+123
                        self.rows.append(row)
        self.save()
        final, = self.call("--aggregate","iqm","--comparable","--reference","ref")
        self.assertEqual((final["budget"], final["phase"], float(final["estimate"])), ("2","test",1.))
        rows = self.call("--phase","validation","--aggregate","iqm","--comparable","--reference","ref")
        self.assertEqual([r["budget"] for r in rows], ["0", "2"])
        self.rows[0]["budget_unit"] = "steps"
        self.save()
        self.assertIn("budget unit", self.call("--aggregate","iqm","--comparable",ok=False))

    def test_unbalanced_and_invalid_options(self):
        self.assertIn("threshold", self.call("--aggregate","profile","--comparable", ok=False))
        self.assertIn("reference", self.call("--aggregate","probability-of-improvement", ok=False))
        self.assertIn("direction", self.call("--aggregate","iqm","--metric","steps","--comparable", ok=False))
        self.rows = [r for r in self.rows if r["target"] != "a" or r["replicate"] != 3]
        self.save()
        self.assertIn("replicate IDs", self.call("--aggregate","iqm","--comparable",ok=False))

if __name__ == "__main__":
    unittest.main()
