# Finite-world Gymnasium adapter

This experiment uses the existing Node normalizer once per environment and runs episodes in Python. It does not change Studio, the runner, the world format or the random generator. Tested on Linux with Python 3.12, Gymnasium 1.4.0, NumPy 2.5.5, Node 24.22.3, and Bend 2.0.40. Other versions and Windows are not verified. Install the optional dependencies in this folder:

    python -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m unittest -v

The optional replay test compiles a small plan if Bend 2.0.40 is available as `bend` or via `BEND`. Run commands from this folder.

    from bend_env import BendFiniteEnv
    env = BendFiniteEnv("../../worlds/bridge.json", horizon=2)
    observation, info = env.reset(seed=42)
    action_id = info["legal_action_ids"][0]
    observation, reward, terminated, truncated, info = env.step(env.action_ids.index(action_id))

The observation is the original numeric **public** observation. Sparse actions map to dense Gym indices through `env.action_ids`; `info["action_mask"]` is indexed by these dense Gym indices, while `legal_action_ids` preserves Bend's public ordering. Agent observations never include the hidden state ID. A globally valid but locally illegal action terminates without advancing or paying a reward, matching Bend rejection. Natural termination takes precedence over the explicit positive horizon. Gymnasium reset cannot return termination flags: an initially terminal world signals `terminal_on_reset` in info; the next in-space step is a zero-reward terminal notification, not a simulated move. For a terminal-only world the static action space has one dummy index with a zero mask.

An explicit U32 seed follows the Bend finite-world reset and domain-separated transition stream. With no seed, Gymnasium's generator supplies a fresh U32 episode seed. Reward and transition bucket rounding are delegated to the existing worldDefinition/buckets code. This implements JSON state-machine and grid worlds, not arbitrary compiled Bend agents or simulators.

Rewards are the original per-step binary32 values, not discounted and not clipped. Compute discounted return in the agent/evaluator as the sum of gamma^t times each reward; a discount changes the optimal policy in some worlds. The included Bridge test uses the same fixed policy at gamma=1 and gamma=0.5, comparing each to the corresponding JS exact return. A time limit reports truncation, not terminality, so the consumer decides whether to bootstrap. Horizon zero is deliberately not supported (no accepted interaction can occur); Gymnasium checkers and ordinary agent loops assume a positive step budget. Reproducibility applies to equal U32 episode seeds and identical chosen actions, not to Gymnasium's separately seeded action-space generator.

For exact **episode-score** parity use `info["bend_episode_score"]`, available on reset and every step. Bend's running score rounds to binary32 after each accepted reward. Summing the same Python float rewards in a logging wrapper can give a different value: [16777216, 1, -16777216] sums to 1 in Python but to 0 in Bend. The score is undiscounted and unchanged on an illegal action. Neither the Gym step reward nor the learner's own discount convention is modified. Use the ordered `legal_action_ids` rather than iterating the sorted dense mask when the policy breaks ties by legal-list order.

**Trust and deployment:** This is a local research reference, not a service endpoint. File paths and the Node executable are chosen by its trusted operator. The constructor parses the supplied world in memory, and the finite-world compiler can expand a grid substantially; the subprocess deadline is not a memory or output-size bound. Do not expose this interface directly to remote or untrusted inputs. Use an isolated process with explicit file, memory and output quotas before considering that use. On Windows the virtual environment uses `Scripts\python.exe` rather than `bin/python`; Windows installation and runtime parity have not been tested.
