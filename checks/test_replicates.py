"""Unit and export-CLI tests for replicate planning."""
import csv
import gzip
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "analysis"))
from replicates import estimate, sign_power


def pilot_rows(differences):
    for replicate, difference in enumerate(differences):
        for arm, score in (("ref", 2), ("challenger", 2 + difference)):
            row = {"game": "fixture", "budget": 8, "budget_unit": "episodes",
                   "arm": arm, "replicate": replicate, "trained_episodes": 8}
            for j, phase in enumerate(("train", "validation", "test")):
                episodes = 8 if phase == "train" else 4
                row.update({f"{phase}_{key}": value for key, value in
                            {"episodes": episodes, "steps": episodes * 2, "terminal": episodes,
                             "limited": 0, "illegal": 0, "sum": score * episodes,
                             "seed": 1 + j * 10000 + replicate * 100}.items()})
            yield row


class ReplicatePlanning(unittest.TestCase):
    def test_balanced_known_variance_and_precision(self):
        # Empirical Rademacher differences +/- 2: normal approximation is (1.96 * 2 / .4)^2=96.
        values = [-2, 2] * 20
        a = estimate(values, .4)
        self.assertEqual(a, estimate(values, .4))
        self.assertEqual(a["pilot_mean_difference"], 0)
        self.assertTrue(85 <= a["required_replicates"] <= 115)
        self.assertLessEqual(a["projected_half_width"], .4)
        self.assertGreater(a["projected_half_width"] *
                           math.sqrt(a["required_replicates"] / (a["required_replicates"] - 1)), .4)
        self.assertGreaterEqual(a["sign_test_power"], 0)
        self.assertLessEqual(a["sign_test_power"], .05)

    def test_exact_sign_power_averages_non_tie_counts(self):
        self.assertEqual(sign_power(5, 1, 1), 0)
        self.assertEqual(sign_power(6, 1, 1), 1)
        self.assertAlmostEqual(sign_power(6, .5, 1), .5 ** 6)
        self.assertAlmostEqual(sign_power(6, 1, .5), 2 / 64)
        self.assertAlmostEqual(sign_power(8, .5, .63), sign_power(8, .5, .37))
        self.assertTrue(0 < sign_power(50, .8, .8) < 1)

    def test_constant_differences_and_limits(self):
        zero = estimate([0] * 6, .5)
        self.assertEqual(zero["required_replicates"], 6)
        self.assertEqual(zero["pilot_ties"], 6)
        self.assertEqual(zero["sign_test_power"], 0)
        self.assertIsNone(zero["p_positive_given_non_tie"])
        self.assertIn("No pilot variance", zero["warning"])
        self.assertEqual(estimate([2] * 6, .5)["sign_test_power"], 1)
        for target in (0, -1, float("inf"), float("nan")):
            with self.assertRaisesRegex(ValueError, "finite and positive"):
                estimate([-2, 2], target)
        with self.assertRaisesRegex(ValueError, "exceeds 2000"):
            estimate([-2, 2], .000001)

    def test_export_cli_and_pair_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "pilot.csv.gz"
            cmd = [sys.executable, str(REPO / "analysis/replicates.py"), str(file), "--game",
                   "fixture", "--budget", "8", "--reference", "ref", "--challenger",
                   "challenger", "--target-half-width", "0.5", "--draws", "2000", "--seed", "17"]
            rows = list(pilot_rows([2, -1, 0, 1, 0, 2, -1, 0]))
            def invoke(rs):
                with gzip.open(file, "wt", encoding="utf-8", newline="") as f:
                    writer = csv.DictWriter(f, rows[0].keys())
                    writer.writeheader()
                    writer.writerows(rs)
                return subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            success = invoke(rows)
            self.assertEqual(success.returncode, 0, success.stderr)
            self.assertEqual(success.stdout, invoke(list(reversed(rows))).stdout)
            data = json.loads(success.stdout)
            self.assertTrue(data["planning_only"])
            self.assertEqual(data["pilot_replicates"], 8)
            self.assertEqual(data["pilot_ties"], 3)
            self.assertEqual(data["bootstrap_seed"], 17)
            self.assertEqual(data["phase"], "validation")
            cases = [
                (rows[:-1], "missing paired replicates"),
                (rows + rows[:1], "duplicate trial checkpoint"),
                (rows[:-1] + [dict(rows[-1], validation_seed=9)], "unpaired validation seed"),
                (rows[:-2] + [dict(r, validation_seed=rows[0]["validation_seed"])
                              for r in rows[-2:]], "distinct, matched seed"),
                (rows[:-1] + [dict(rows[-1], validation_sum="nan")], "must be finite"),
            ]
            for bad, message in cases:
                with self.subTest(message=message):
                    result = invoke(bad)
                    self.assertEqual(result.returncode, 2, result.stdout)
                    self.assertIn(message, result.stderr)


if __name__ == "__main__":
    unittest.main()
