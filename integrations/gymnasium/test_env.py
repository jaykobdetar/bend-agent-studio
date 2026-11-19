import json
import math
from pathlib import Path
import subprocess
import unittest

import gymnasium as gym
from gymnasium.utils.env_checker import check_env

from bend_env import BendFiniteEnv, _draw, _distribution

ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "worlds" / "bridge.json"


class Contracts(unittest.TestCase):
    def test_checker_and_seeded_reproducibility(self):
        env = BendFiniteEnv(BRIDGE, horizon=2)
        check_env(env, skip_render_check=True)
        for seed in (0, 1, 42, 0xffffffff):
            def episode():
                obs, info = env.reset(seed=seed)
                frames = []
                while True:
                    aid = info["legal_action_ids"][-1]
                    obs, r, t, x, info = env.step(env.action_ids.index(aid))
                    frames.append((obs, r, t, x))
                    if t or x:
                        return frames
            self.assertEqual(episode(), episode())

    def test_bucket_boundary_words(self):
        source = {"schema":1,"initial":[{"to":0,"weight":1}],"states":[
            {"id":0,"actions":[{"id":0,"outcomes":[{"to":i+1,"reward":i,"weight":w}
             for i,w in enumerate([1,2,0xffffffff-2])]}]}]+[{"id":i,"actions":[]} for i in (1,2,3)]}
        compiled=json.loads(subprocess.check_output(["node",str(Path(__file__).with_name("compile_world.mjs"))],
                                input=json.dumps(source),text=True))
        xs=compiled["states"][0]["actions"][0]["outcomes"]
        self.assertEqual([x["upper"] for x in xs],[0,2,0xffffffff])
        self.assertEqual([_draw(_distribution(xs),w)["to"] for w in (0,1,2,3,0xffffffff)],[1,2,2,3,3])

    def test_sparse_legal_actions_terminal_and_truncation(self):
        env=BendFiniteEnv(BRIDGE,horizon=1)
        _,info=env.reset(seed=0)
        self.assertEqual(env.action_ids,(0,7,9))
        self.assertEqual(info["legal_action_ids"],(0,7))
        self.assertEqual(env.step(0)[2:4],(True,False))  # natural termination beats horizon
        env.reset(seed=0)
        self.assertEqual(env.step(1)[2:4],(False,True))
        env.reset(seed=0)
        obs,r,t,x,info=env.step(2)
        self.assertEqual((obs,r,t,x,info["reason"]),(0,0.0,True,False,"illegal"))
        with self.assertRaises(gym.error.ResetNeeded): env.step(0)
        end=BendFiniteEnv({"schema":1,"initial":[{"to":1,"weight":1}],
                           "states":[{"id":1,"observation":0xffffffff,"actions":[]}]},horizon=1)
        obs,info=end.reset(seed=2)
        self.assertEqual((obs,info["reason"]),(0xffffffff,"terminal_on_reset"))
        self.assertEqual(end.step(0)[1:4],(0.0,True,False))
        grid=BendFiniteEnv({"schema":1,"grid":["SG"],"goalReward":7},horizon=1)
        _,info=grid.reset(seed=0)
        self.assertEqual(grid.step(grid.action_ids.index(info["legal_action_ids"][0]))[1:4],(7.,True,False))

    def test_oracle_policy_meets_sampling_bound(self):
        env=BendFiniteEnv(BRIDGE,horizon=2)
        exact=json.loads(subprocess.check_output(["node",str(ROOT/"experiment.mjs"),"oracle",str(BRIDGE),"2"],text=True))
        returns=[]
        discounted=[]
        for seed in range(20000):
            _,info=env.reset(seed=seed)
            _,r,_,_,info=env.step(env.action_ids.index(7))
            _,s,_,_,_=env.step(env.action_ids.index(9))
            returns.append(r+s)
            discounted.append(r+0.5*s)
        mean=sum(returns)/len(returns)
        # For the oracle-optimal Bridge path: 3 w.p. 3/4, -1 w.p. 1/4.
        self.assertLess(abs(mean-exact["optimalFullStateReturn"]),5*math.sqrt(3/len(returns)))
        command = """import fs from 'node:fs';import {worldDefinition} from './core/finite_world.mjs';
import {policyOracle} from './core/public_oracle.mjs';
const w=worldDefinition(JSON.parse(fs.readFileSync('worlds/bridge.json')));
console.log(policyOracle(w,2,obs=>obs===0?7:9,{discount:0.5}).expectedReturn);"""
        discounted_truth = float(subprocess.check_output(["node","--input-type=module","-e",command],cwd=ROOT,text=True))
        sampled_discounted = sum(discounted)/len(discounted)
        self.assertAlmostEqual(discounted_truth,0.875)
        self.assertLess(abs(sampled_discounted-discounted_truth),5*math.sqrt(2/len(returns)))
        print(f"Bridge discounted fixed policy: {sampled_discounted:.6f} vs {discounted_truth:.6f}")
        print(f"Bridge: sampled {mean:.6f} over {len(returns)} seeds; oracle {exact['optimalFullStateReturn']}")

    def test_all_shipped_json_worlds_and_exact_rational_cutpoints(self):
        found=0
        for file in sorted((ROOT/"worlds").glob("*.json")):
            raw=json.loads(file.read_text())
            if "grid" not in raw and not isinstance(raw.get("states"),list):
                continue
            data = json.loads(subprocess.check_output(["node",str(Path(__file__).with_name("compile_world.mjs"))],
                              input=file.read_text(),text=True))
            for xs in [data["initial"]]+[a["outcomes"] for s in data["states"] for a in s["actions"]]:
                denominator=sum(x["weight"] for x in xs)
                cumulative=0
                dist=_distribution(xs)
                for x in xs:
                    left=cumulative*(1<<32)//denominator
                    cumulative+=x["weight"]
                    right=cumulative*(1<<32)//denominator-1
                    self.assertEqual(x["upper"],right)
                    self.assertEqual(_draw(dist,left),x)
                    self.assertEqual(_draw(dist,right),x)
            found+=1
        self.assertGreaterEqual(found,15)
        print(f"Validated all {found} shipped JSON worlds against exact integer cutpoints.")

    def test_binary32_reward_rounding_and_signed_zero(self):
        def run(reward):
            e=BendFiniteEnv({"schema":1,"initial":[{"to":0,"weight":1}],"states":[
                {"id":0,"actions":[{"id":3,"outcomes":[{"weight":1,"reward":reward,"to":1}]}]},
                {"id":1,"actions":[]}]},horizon=1)
            e.reset(seed=3)
            return e.step(0)[1]
        self.assertEqual(math.copysign(1,run(-0.0)),-1.)
        self.assertEqual(run(16777217),16777216.)

    def test_public_score_uses_sequential_f32_add_and_rejection_preserves_it(self):
        rewards=[16777216.0,1.0,-16777216.0]
        world={"schema":1,"initial":[{"to":0,"weight":1}],"states":[
            {"id":i,"actions":[{"id":2,"outcomes":[{"weight":1,"to":i+1,"reward":r}]}]}
            for i,r in enumerate(rewards)]+[{"id":3,"actions":[]}]}
        env=BendFiniteEnv(world,horizon=3)
        _,info=env.reset(seed=0)
        self.assertEqual(info["bend_episode_score"],0.0)
        scores=[]; received=[]
        for i in range(3):
            _,r,t,x,info=env.step(0);received.append(r);scores.append(info["bend_episode_score"])
        self.assertEqual(scores,[16777216.,16777216.,0.])
        self.assertEqual(sum(received),1.0)
        self.assertEqual((t,x),(True,False))
        # Public legal order is not derivable from the dense mask or sorted IDs.
        world["states"][0]["actions"].insert(0,{"id":99,"outcomes":[{"to":1,"weight":1,"reward":4.0}]})
        env=BendFiniteEnv(world,horizon=3)
        _,info=env.reset(seed=1)
        self.assertEqual(info["legal_action_ids"],(99,2))
        self.assertEqual(env.action_ids,(2,99))
        env.step(1)
        _,r,t,x,info=env.step(1)
        self.assertEqual((r,t,x,info["bend_episode_score"]),(0.,True,False,4.))
