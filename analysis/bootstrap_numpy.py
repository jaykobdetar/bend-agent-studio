"""Optional same-seed fixed-suite probability-of-improvement bootstrap."""
import statistics

import numpy as np


def superiority_draws(xs, ys, blocks, draws, rng):
    """Vectorize pair counts; preserve Python's final mean and draw order."""
    games, n = len(xs), len(xs[0])
    common = blocks == "across-games"
    ids_per_draw = n * (1 if common else games)
    batch = max(1, min(draws, 65536 // (games * n * n)))
    x_values = np.asarray(xs, dtype=np.float64)
    y_values = np.asarray(ys, dtype=np.float64)
    task_ids = np.arange(games)[None, :, None]
    population = range(n)
    sims = []
    for start in range(0, draws, batch):
        size = min(batch, draws - start)
        # Equal-weight Random.choices consumes one draw per index; grouping
        # calls changes allocation, not which index each position receives.
        ids = np.asarray(rng.choices(population, k=size * ids_per_draw), dtype=np.intp)
        ids = ids.reshape(size, 1 if common else games, n)
        left = x_values[task_ids, ids][..., :, None]
        right = y_values[task_ids, ids][..., None, :]
        twice_wins = 2 * np.sum(left > right, axis=(-2, -1)) + np.sum(left == right, axis=(-2, -1))
        sims.extend(statistics.fmean(row) for row in (twice_wins / (2 * n * n)).tolist())
    return sims
