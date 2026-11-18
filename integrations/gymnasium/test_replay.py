"""Optional parity check against actual Bend-generated episode traces."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from bend_env import BendFiniteEnv

ROOT = Path(__file__).resolve().parents[2]
BEND = os.environ.get("BEND", "bend")

@unittest.skipUnless(shutil.which(BEND), "Bend compiler unavailable")
class BendReplay(unittest.TestCase):
    def test_authored_and_grid_frames_match_compiled_bend(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            plan = json.loads((ROOT / "experiments/bridge.json").read_text())
            plan.update(replicates=1, checkpoints=[0], validationEpisodes=12, testEpisodes=12)
            plan["arms"]=[{"id":"random","method":"random"}]
            plan["games"]=[{"id":"bridge","file":str(ROOT / "worlds/bridge.json"),"limit":2},
                           {"id":"tiger","file":str(ROOT / "worlds/tiger.json"),"limit":8},
                           {"id":"grid","file":str(ROOT / "worlds/slippery-detour.json"),"limit":10}]
            (root/"plan.json").write_text(json.dumps(plan))
            subprocess.run(["node",str(ROOT/"experiment.mjs"),"run","plan.json","archive","--bend",BEND],
                           cwd=root,check=True,capture_output=True,timeout=60)
            count=0
            for game in plan["games"]:
                env=BendFiniteEnv(game["file"],horizon=game["limit"])
                for i in range(12):
                    data=json.loads(subprocess.check_output(["node","archive/code/experiment.mjs","replay",
                        "archive",game["id"],"random","0","0","test",str(i)],cwd=root,text=True,timeout=20))
                    obs,info=env.reset(seed=data["seed"])
                    for frame in data["frames"]:
                        self.assertEqual(obs,frame["observation"])
                        self.assertEqual(list(info["legal_action_ids"]),frame["legal"])
                        obs,r,t,x,info=env.step(env.action_ids.index(frame["action"]))
                        self.assertEqual((obs,r,t,x),(frame["nextObservation"],frame["reward"],
                                                      frame["terminal"],frame["truncated"]))
                        self.assertEqual(list(info["legal_action_ids"]),frame["nextLegal"])
                        count+=1
                    self.assertEqual(info["bend_episode_score"],data["score"])
            print(f"Compiled Bend replay: 36 episodes, {count} matching frames")
