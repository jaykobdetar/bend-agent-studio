# Fixed collected fixture

This is actual `batch.mjs collect` output, not hand-built transitions.
It was collected from `experiments/cliff-linear.json` (four replicates,
tabular `q-learning` arm at checkpoint 128), Bend 2.0.40 / Node 24.22.3.
The collection design in `collection.json` fixes all seeds and epsilon.
There are 24 episodes and 375 accepted transitions across fit/holdout.
The source run/backend/checkpoint hashes remain sealed in the collection.
They identify provenance, not a bundled runnable source environment.
Recreate by running that plan, then:
`node batch.mjs collect RUN integrations/minari/fixtures/collection.json OUT`.
Source code changes can legitimately change archived hashes.
