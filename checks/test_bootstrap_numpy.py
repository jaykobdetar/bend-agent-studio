"""Same-seed parity and fallback checks for optional NumPy superiority."""
import importlib.util
import os
from pathlib import Path
import random
import struct
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analysis"))

from suite_stats import bootstrap, estimate, numpy_safe


def fp_bytes(values):
    return [struct.pack("!d", v) for v in values]


XS = [[-2.5, 1., 1.5, 1.5, 9.25], [0., 0., 1e-200, 4.5, 6.], [-3., 1.5, 6., 1., -0.]]
YS = [[v + (-1.) ** i for i, v in enumerate(task)] for task in XS]
MODE = "probability-of-improvement"


def interval(setting, xs=XS, ys=YS, mode=MODE, threshold=None, blocks="within-game"):
    with patch.dict(os.environ, {"BEND_ANALYSIS_NUMPY": setting}):
        return bootstrap(xs, ys, mode, threshold, blocks, 5000, "panel")


@unittest.skipUnless(importlib.util.find_spec("numpy"), "optional NumPy not installed")
class NumPyParity(unittest.TestCase):
    def test_same_rng_state_and_each_simulated_value_across_chunks(self):
        from bootstrap_numpy import superiority_draws

        for blocks in ["within-game", "across-games"]:
            with self.subTest(blocks=blocks):
                n = len(XS[0])
                reference = random.Random(154)
                values = []
                for _ in range(5000):
                    common = reference.choices(range(n), k=n) if blocks == "across-games" else None
                    ids = [reference.choices(range(n), k=n) if common is None else common for _ in XS]
                    x = [[row[i] for i in js] for row, js in zip(XS, ids)]
                    y = [[row[i] for i in js] for row, js in zip(YS, ids)]
                    values.append(estimate(x, y, MODE))
                fast = random.Random(154)
                self.assertEqual(fp_bytes(superiority_draws(XS, YS, blocks, 5000, fast)), fp_bytes(values))
                self.assertEqual(reference.getstate(), fast.getstate())
                self.assertEqual(fp_bytes(interval("0", blocks=blocks)), fp_bytes(interval("1", blocks=blocks)))

    def test_missing_numpy_falls_back_even_when_requested(self):
        expected = interval("0")
        with patch.dict(sys.modules, {"numpy": None}):
            sys.modules.pop("bootstrap_numpy", None)
            self.assertEqual(fp_bytes(interval("1")), fp_bytes(expected))

    def test_ineligible_inputs_and_other_modes_never_import_numpy(self):
        # A blocked helper import would surface here if any fallback tried it.
        panels = [[[2**53 + 1, 0]], [list(range(65))]]
        with patch.dict(sys.modules, {"bootstrap_numpy": None}):
            for panel in panels:
                self.assertFalse(numpy_safe(panel, panel, 5000))
                self.assertEqual(interval("1", panel, panel), interval("0", panel, panel))
            for mode, threshold in (("iqm", None), ("profile", 0.5)):
                self.assertEqual(interval("1", mode=mode, threshold=threshold),
                                 interval("0", mode=mode, threshold=threshold))
