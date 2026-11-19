import {createHash} from 'node:crypto';
import {checkedBundle,namedParameters,parameterList} from './agent_source.mjs';
import {worldDefinition} from './finite_world.mjs';

export const games = Object.freeze({
  doors: 'DoorsGame', orchard: 'OrchardGame', ferry: 'FerryGame',
  key_maze: 'MazeGame', cliff: 'CliffGame', noisy_fork: 'NoisyForkGame', mountain_car: 'MountainCar', cartpole:'CartPole',
});
export const methods = Object.freeze({
  random: 'Uniform', sample_mean: 'MeanReward', q_learning: 'QLearning', expected_sarsa: 'ExpectedSarsa', double_q: 'DoubleQ', dyna_q: 'DynaQ', coarse_q: 'CoarseQ', tile_q: 'TileQ', tile_expected: 'TileExpected', linear_ac:'LinearAC', network_ac:'NetworkAC',
});

export function canonical(value) {
  // Bend lists and inductive trees can be deeper than the JavaScript call stack.
  const pieces=[], active=new Set(), pending=[{value}];
  while (pending.length) {
    const next=pending.pop();
    if (next.close!==undefined) {
      active.delete(next.close);
      pieces.push(Array.isArray(next.close)?']':'}');
    } else if (next.text!==undefined) {
      pieces.push(next.text);
    } else {
      const x=next.value;
      if (x===null || typeof x==='boolean' || typeof x==='string') pieces.push(JSON.stringify(x));
      else if (typeof x==='number') {
        if (!Number.isFinite(x)) throw Error('non-finite number in experiment data');
        pieces.push(Object.is(x,-0)?'-0':String(x));
      } else if (x && typeof x==='object') {
        if (active.has(x)) throw Error('cycle in experiment data');
        active.add(x);
        const array=Array.isArray(x), keys=array?null:Object.keys(x).sort(), n=array?x.length:keys.length;
        pieces.push(array?'[':'{');
        pending.push({close:x});
        for (let i=n-1;i>=0;i--) {
          const key=array?i:keys[i];
          pending.push({value:x[key]});
          if (!array) pending.push({text:JSON.stringify(key)+':'});
          if (i) pending.push({text:','});
        }
      } else throw Error('missing or unsupported value in experiment data');
    }
  }
  return pieces.join('');
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fields(obj, allowed, label) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw Error(label + ' must be an object');
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw Error(label + ' has an unknown field ' + k);
  }
}

function integer(x, low, high, label) {
  if (!Number.isSafeInteger(x) || x < low || x > high) throw Error(label + ' must be an integer in [' + low + ', ' + high + ']');
  return x;
}

function fraction(x, label) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) throw Error(label + ' must be a number from 0 to 1');
  return x;
}

function identifier(string, label) {
  if (typeof string !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(string)) throw Error(label + ' must be a lowercase identifier');
  return string;
}

function collection(xs, label) {
  if (!Array.isArray(xs) || !xs.length) throw Error(label + ' must be a nonempty list');
  return xs;
}

function unique(xs, label) {
  if (new Set(xs).size !== xs.length) throw Error('duplicate ' + label);
}

const U32_MAX = 0xffffffff;
export function validate(input) {
  fields(input, ['schema','name','games','evaluationGames','arms','replicates','checkpoints','validationEpisodes','testEpisodes','seeds','budgetUnit','maxTrainEpisodes'], 'experiment');
  if (input.schema !== 1) throw Error('unsupported experiment schema');
  identifier(input.name, 'name');
  const normalizeGame = g => {
    fields(g, ['id','limit','definition','world','parameters','domain'], 'game');
    identifier(g.id,'game id');
    if (g.world!==undefined) {
      if (g.definition!==undefined || Object.hasOwn(games,g.id)) throw Error('custom world has conflicting definitions');
      const domain=identifier(g.domain??'discrete','observation domain');
      return {id:g.id,limit:integer(g.limit,1,U32_MAX,'step limit'),world:checkedBundle(g.world),
        domain,parameters:namedParameters(g.parameters)};
    }
    if (g.parameters!==undefined || g.domain!==undefined) throw Error('world parameters and domain require a Bend world');
    if (g.definition!==undefined) {
      if (Object.hasOwn(games,g.id)) throw Error('authored game shadows a built-in game');
      return {id:g.id,limit:integer(g.limit,1,U32_MAX,'step limit'),definition:worldDefinition(g.definition)};
    }
    if (!Object.hasOwn(games,g.id)) throw Error('unknown game ' + g.id);
    return {id:g.id, limit:integer(g.limit, 1, U32_MAX, 'step limit')};
  };
  const worlds=collection(input.games,'games').map(normalizeGame);
  const evaluationGames=input.evaluationGames===undefined?[]:collection(input.evaluationGames,'evaluationGames').map(normalizeGame);
  const allGames=[...worlds,...evaluationGames];
  const arms = collection(input.arms, 'arms').map(a => {
    fields(a, ['id','method','epsilon','alpha','gamma','observation','planningSteps','criticRate','agent','parameters','domain'], 'arm');
    identifier(a.id, 'arm id');
    const observation=a.observation??'current';
    if (!['current','previous'].includes(observation)) throw Error('observation must be current or previous');
    if (a.method==='custom') {
      const domain=a.domain??'discrete';
      identifier(domain,'observation domain');
      for (const key of ['alpha','epsilon','gamma','planningSteps','criticRate']) {
        if (Object.hasOwn(a,key)) throw Error('put custom algorithm settings in parameters');
      }
      return {id:a.id,method:'custom',domain,observation,agent:checkedBundle(a.agent),parameters:namedParameters(a.parameters)};
    }
    if (a.agent!==undefined || a.parameters!==undefined || a.domain!==undefined) throw Error('agent, domain and parameters require method custom');
    if (!Object.hasOwn(methods,a.method)) throw Error('unknown method '+a.method);
    if (a.planningSteps!==undefined && a.method!=='dyna_q') throw Error('planningSteps is only used by Dyna-Q');
    const planning=a.method==='dyna_q'?{planningSteps:integer(a.planningSteps??5,0,U32_MAX,'planningSteps')}:{};
    const ac=['linear_ac','network_ac'].includes(a.method);
    if (!ac && a.criticRate!==undefined) throw Error('criticRate is used by actor-critic methods');
    const critic=ac?{criticRate:Math.fround(fraction(a.criticRate??0.02,'criticRate'))}:{};
    const epsilon = fraction(a.epsilon ?? 0.25, 'epsilon');
    const buckets = Math.round(epsilon * 65536);
    return {id:a.id, method:a.method, observation, epsilon, buckets,...planning,...critic,
      alpha:Math.fround(fraction(a.alpha ?? (ac?0.003:0.25),'alpha')), gamma:Math.fround(fraction(a.gamma ?? 0.9,'gamma'))};
  });
  for (const game of allGames) for (const arm of arms) {
    if (arm.observation==='previous') {
      if (!game.definition) throw Error('previous-observation encoder requires an authored world');
      const size=new Set(game.definition.states.map(s=>s.observation)).size;
      if (size*(size+1)>2**32) throw Error('observation history would exceed the U32 feature space');
    }
    if (arm.method==='custom') {
      const domain=game.domain??(['cartpole','mountain_car'].includes(game.id)?game.id:'discrete');
      if (arm.domain!==domain) throw Error('custom agent observation domain does not match '+game.id);
      continue;
    }
    const domain=game.domain??game.id;
    if (game.world && !['discrete','mountain_car','cartpole'].includes(domain)) throw Error('this observation domain needs a matching custom agent');
    const family=domain==='mountain_car'?'tile':domain==='cartpole'?'actor':'tabular';
    const methodFamily=['coarse_q','tile_q','tile_expected'].includes(arm.method)?'tile':
      ['linear_ac','network_ac'].includes(arm.method)?'actor':'tabular';
    if (arm.method!=='random' && family!==methodFamily) throw Error('method '+arm.method+' is incompatible with '+game.id);
  }
  unique(allGames.map(g=>g.id),'game id');
  unique(arms.map(a=>a.id),'arm id');
  const checkpoints = collection(input.checkpoints, 'checkpoints').map(n=>integer(n,0,U32_MAX,'checkpoint'));
  if (checkpoints[0] !== 0 || checkpoints.some((n,i)=>i>0 && n<=checkpoints[i-1])) throw Error('checkpoints must start at zero and increase strictly');
  const budgetUnit=input.budgetUnit??'episodes';
  if (!['steps','episodes'].includes(budgetUnit)) throw Error('budgetUnit must be steps or episodes');
  const maxTrainEpisodes=integer(input.maxTrainEpisodes??checkpoints.at(-1),0,U32_MAX,'maxTrainEpisodes');
  if (budgetUnit==='episodes' && maxTrainEpisodes!==checkpoints.at(-1)) throw Error('episode budget and maxTrainEpisodes disagree');
  const replicates = integer(input.replicates,1,100000,'replicates');
  const validationEpisodes = integer(input.validationEpisodes,1,U32_MAX,'validationEpisodes');
  const testEpisodes = integer(input.testEpisodes,0,U32_MAX,'testEpisodes');
  fields(input.seeds, ['train','validation','test','stride'], 'seeds');
  const seeds = Object.fromEntries(['train','validation','test','stride'].map(k=>[k,integer(input.seeds[k], k==='stride'?1:0,U32_MAX,'seeds.'+k)]));
  checkSeedBlocks([{checkpoints,maxTrainEpisodes,replicates,validationEpisodes,testEpisodes,seeds}]);
  return {schema:1,name:input.name,games:worlds,...(evaluationGames.length?{evaluationGames}:{}),arms,replicates,checkpoints,budgetUnit,maxTrainEpisodes,validationEpisodes,testEpisodes,seeds};
}

export function checkSeedBlocks(plans) {
  const intervals=[];
  for (const [stage,p] of plans.entries()) {
    for (const [phase,n] of Object.entries({train:p.initializesModel===false?0:Math.max(1,p.maxTrainEpisodes??p.checkpoints.at(-1)),validation:p.validationEpisodes,test:p.testEpisodes})) {
      if (!n) continue;
      for (let rep=0; rep<p.replicates; rep++) {
        const start=seedOf(p,rep,phase), end=start+n-1;
        if (end>U32_MAX) throw Error('seed block exceeds U32 for '+phase+' replicate '+rep);
        intervals.push({start,end,label:stage+'/'+phase+'/'+rep});
      }
    }
  }
  intervals.sort((a,b)=>a.start-b.start);
  for (let i=1;i<intervals.length;i++) {
    if (intervals[i].start<=intervals[i-1].end) throw Error('overlapping seed blocks '+intervals[i-1].label+' and '+intervals[i].label);
  }
}

export function settings(arm, game) {
  if (arm.method==='custom') return parameterList(arm.parameters);
  if ((game.domain??game.id)==='cartpole') return {$:'ACSettings',method:{$:arm.method==='random'?'RandomPole':methods[arm.method]},
    actor_rate:arm.alpha,critic_rate:arm.criticRate??0,gamma:arm.gamma};
  if ((game.domain??game.id)==='mountain_car') return {$:'TileSettings',method:{$:arm.method==='random'?'RandomCar':methods[arm.method]},
    alpha:arm.alpha,gamma:arm.gamma,exploration:arm.buckets};
  return {$:'Settings',method:arm.method==='dyna_q'?{$:'DynaQ',planning:arm.planningSteps}:{$:methods[arm.method]},alpha:arm.alpha,gamma:arm.gamma,exploration:arm.buckets};
}

export function *trials(plan) {
  for (let rep=0; rep<plan.replicates; rep++) {
    for (const game of plan.games) {
      for (const arm of plan.arms) yield {rep,game,arm};
    }
  }
}

export function seedOf(plan, rep, phase) {
  return plan.seeds[phase]+rep*plan.seeds.stride;
}
