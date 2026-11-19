// Evaluate the shipped deterministic alternating games through their compiled Bend worlds and policies.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundleAgent,parameterList} from '../core/agent_source.mjs';
import {canonical,digest} from '../core/experiment_config.mjs';
import {checkedSnapshot,existing,immutable,manifestPath,seal,unpack,unseal} from '../core/experiment.mjs';

const here=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bendLibraryDir=path.join(here,'core');
const words=2**32;

// Children precede parents. Each edge keeps the actual first-seat reward from Bend.
export function gameGraph(world,limit) {
  const nodes=[],seen=new Map(),active=new Set();
  function visit(state) {
    const key=canonical(state);
    if(seen.has(key)) return seen.get(key);
    if(active.has(key)) throw Error('the tournament requires an acyclic game');
    active.add(key);
    const view=world.view(state),edges=[];
    let height=0;
    if(view.$==='Open') {
      if(view.observation.$!=='Mover') throw Error('expected an arena observation');
      const legal=unpack(view.actions);
      if(!legal.length || new Set(legal).size!==legal.length) throw Error('invalid arena action list');
      for(const action of legal) {
        const {fst:next,snd:reward}=world.step(state)(action)(0);
        const child=visit(next);
        edges.push({action,child,reward});
        height=Math.max(height,1+nodes[child].height);
      }
    } else if(view.$!=='End') throw Error('unknown arena view');
    active.delete(key);
    const id=nodes.length;
    nodes.push({view,edges,height});seen.set(key,id);
    return id;
  }
  const root=visit(world.reset(0));
  if(nodes[root].height>limit) throw Error('a legal game can exceed the declared terminal horizon');
  return {nodes,root};
}

function moduloWeights(n) {
  const whole=Math.floor(words/n),extra=words%n;
  return Array.from({length:n},(_,i)=>(whole+Number(i<extra))/words);
}

// A null policy computes a best response. Values stay in first-seat units.
export function matchup(graph,first,second) {
  const scores=new Float64Array(graph.nodes.length);
  for(const [id,node] of graph.nodes.entries()) {
    if(!node.edges.length) continue;
    const other=node.view.observation.second,policy=other?second:first;
    const moves=node.edges.map(e=>e.reward+scores[e.child]);
    if(!policy) scores[id]=other?Math.min(...moves):Math.max(...moves);
    else {
      const pick=policy[id];
      scores[id]=Array.isArray(pick)?moves.reduce((s,v,i)=>s+pick[i]*v,0):moves[pick];
    }
  }
  return scores[graph.root];
}

function choices(graph,model,act) {
  const uniform=model.config.method.$==='Uniform';
  const choices=new Map(),weights=new Map();
  return graph.nodes.map(({view,edges})=>{
    if(!edges.length) return null;
    if(uniform) {
      if(!weights.has(edges.length)) weights.set(edges.length,moduloWeights(edges.length));
      return weights.get(edges.length);
    }
    const key=canonical([view.observation,edges.map(e=>e.action)]);
    if(!choices.has(key)) {
      const action=act(model,view.observation,view.actions,{$:'Evaluate'},0);
      const at=edges.findIndex(e=>e.action===action);
      if(at<0) throw Error('frozen policy returned an illegal action');
      choices.set(key,at);
    }
    return choices.get(key);
  });
}

async function tournament(root,out) {
  const manifest=unseal(manifestPath(root)),{plan,toolchain}=manifest.body;
  if(toolchain.node!==process.versions.node) throw Error('this study used Node '+toolchain.node);
  checkedSnapshot(root,manifest);
  const api=(await import(pathToFileURL(path.join(root,'code','backend.mjs')).href)).default;
  const player=bundleAgent(path.join(here,'agents/self_play.bend'),bendLibraryDir).entry;
  const supported=['tictactoe','takeaway','two-pile-nim'].map(name=>bundleAgent(path.join(here,'worlds',name+'.bend'),bendLibraryDir).entry);
  if(plan.arms.some(a=>a.agent?.entry!==player) || plan.games.some(g=>!supported.includes(g.world?.entry)))
    throw Error('this exact tournament supports the shipped self-play agent and deterministic arena games');
  const single=['game,arm,replicate,budget,checkpoint_hash,minimax_first,worst_first,worst_second,exploitability,self_play_first'];
  const pairs=['game,replicate,budget,first,second,first_payoff'];
  const counts={};
  for(const game of plan.games) {
    const world=api[game.world.entry+':world'](parameterList(game.parameters));
    const graph=gameGraph(world,game.limit);
    const value=matchup(graph,null,null);
    counts[game.id]={states:graph.nodes.length,edges:graph.nodes.reduce((s,n)=>s+n.edges.length,0),minimaxFirst:value};
    for(let rep=0;rep<plan.replicates;rep++) {
      const previous=new Map();
      for(const n of plan.checkpoints) {
        const policies=new Map();
        for(const arm of plan.arms) {
          const row=existing(root,manifest.hash,{game,arm,rep},n,previous.get(arm.id)??null);
          if(!row) throw Error('missing tournament checkpoint '+[game.id,arm.id,rep,n].join('/'));
          previous.set(arm.id,row.hash);
          const pi=choices(graph,row.body.model,api[player+':act']);
          const worstFirst=matchup(graph,pi,null),worstSecond=-matchup(graph,null,pi);
          const gap=-(worstFirst+worstSecond)/2;
          if(worstFirst>value+1e-10 || worstSecond> -value+1e-10) throw Error('best-response bounds failed');
          single.push([game.id,arm.id,rep,n,row.hash,value,worstFirst,worstSecond,gap,matchup(graph,pi,pi)].join(','));
          policies.set(arm.id,pi);
        }
        if(n===plan.checkpoints.at(-1)) for(const [first,a] of policies) for(const [second,b] of policies) {
          pairs.push([game.id,rep,n,first,second,matchup(graph,a,b)].join(','));
        }
      }
    }
  }
  const ratings=single.join('\n')+'\n',crossplay=pairs.join('\n')+'\n';
  immutable(path.join(out,'ratings.csv'),ratings);
  immutable(path.join(out,'crossplay.csv'),crossplay);
  immutable(path.join(out,'tournament.json'),seal({source:manifest.hash,backend:toolchain.backend,
    evaluator:digest(fs.readFileSync(fileURLToPath(import.meta.url))),counts,ratings:digest(ratings),crossplay:digest(crossplay)}));
  console.log(JSON.stringify({ratings:single.length-1,crossplay:pairs.length-1,games:counts}));
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  if(process.argv.length!==4) {console.error('usage: node analysis/arena_tournament.mjs RUN_DIRECTORY OUTPUT_DIRECTORY');process.exitCode=1;}
  else tournament(path.resolve(process.argv[2]),path.resolve(process.argv[3])).catch(e=>{console.error(e.message);process.exitCode=1;});
}
