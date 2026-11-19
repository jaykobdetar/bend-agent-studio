// Compare every legally reachable board and move against independent physical coordinates.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parameterList} from '../core/agent_source.mjs';
import {checkedSnapshot,manifestPath,unpack,unseal} from '../core/experiment.mjs';
import {gameGraph,matchup} from '../analysis/arena_tournament.mjs';

const root=process.argv[2];
if(!root) throw Error('usage: node checks/arena_checks.mjs SELF_PLAY_RUN_DIRECTORY');
const manifest=unseal(manifestPath(root));
checkedSnapshot(root,manifest);
const api=(await import(pathToFileURL(path.resolve(root,'code/backend.mjs')).href)).default;
const plan=manifest.body.plan;
const winLines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const wins=bits=>winLines.some(line=>line.every(i=>(bits&(1<<i))!==0));
const transform=Array.from({length:8},(_,pose)=>Array.from({length:9},(_,i)=>{
  let row=Math.floor(i/3),col=i%3;
  if(pose>=4) col=2-col;
  for(let j=0;j<pose%4;j++) [row,col]=[col,2-row];
  return row*3+col;
}));
function orient(bits,map) {
  return map.reduce((out,at,i)=>out|(((bits>>i)&1)<<at),0);
}
function checkBoard(game,symmetric) {
  const world=api[game.world.entry+':world'](parameterList(game.parameters));
  const seen=new Set();
  let edges=0;
  function visit(state) {
    const {x,o,second}=state,key=x*512+o;
    if(seen.has(key))return;
    seen.add(key);
    const view=world.view(state),occupied=x|o;
    if(wins(x)||wins(o)||occupied===511) {assert.equal(view.$,'End');return;}
    let best=Infinity,map;
    for(const candidate of symmetric?transform:[transform[0]]) {
      const k=512*orient(second?o:x,candidate)+orient(second?x:o,candidate);
      if(k<best) {best=k;map=candidate;}
    }
    assert.deepEqual(view.observation,{$:'Mover',second,key:best});
    const physical=Array.from({length:9},(_,i)=>i).filter(i=>(occupied&(1<<i))===0);
    assert.deepEqual(unpack(view.actions),physical.map(i=>map[i]).sort((a,b)=>a-b));
    for(const cell of physical) {
      const nx=second?x:x|(1<<cell),no=second?o|(1<<cell):o;
      const next=world.step(state)(map[cell])(0xffffffff);
      assert.deepEqual(next.fst,{$:'Board',x:nx,o:no,second:!second,symmetry:symmetric});
      assert.equal(next.snd,wins(nx)?1:wins(no)?-1:0);
      edges++;visit(next.fst);
    }
  }
  visit(world.reset(0));
  assert.deepEqual([seen.size,edges],[5478,16167]);
  assert.equal(matchup(gameGraph(world,game.limit),null,null),0);
}
checkBoard(plan.games.find(g=>g.id==='tic-tac-toe'),true);
checkBoard(plan.games.find(g=>g.id==='raw-board'),false);
const takeaway=plan.games.find(g=>g.id==='takeaway');
const pile=api[takeaway.world.entry+':world'](parameterList(takeaway.parameters));
assert.equal(matchup(gameGraph(pile,11),null,null),1);

const module=plan.arms.find(a=>a.id==='negamax-q').agent.entry;
const initial=rule=>api[module+':initial'](4,parameterList({rule,alpha:1,gamma:1,epsilon:0}));
const move=(second,key)=>({$:'Mover',second,key});
const end={$:'End',observation:{$:'Over'}};
const next=(second,key)=>({$:'Open',observation:move(second,key),actions:{$:'Con',head:7,tail:{$:'Nil'}}});
const learn=(model,side,k,reward,after)=>api[module+':learn'](model,{$:'Transition',observation:move(side,k),action:7,reward,next:after,truncated:false});
const value=(model,key)=>api['tabular:lookup'](api['arena_table:get'](key,model.table),0,7);
for(const rule of [1,2]) for(const current of [false,true]) for(const following of [false,true]) {
  let model=learn(initial(rule),following,11,following?-3:3,end);
  assert.equal(value(model,11),3);
  model=learn(model,current,12,1,next(following,11));
  assert.equal(value(model,12),(current?-1:1)*(1+(following?-3:3)));
}
let mc=learn(initial(3),false,1,0,next(true,2));
assert.equal(value(mc,1),0);
mc=learn(mc,true,2,-1,end);
assert.equal(value(mc,1),-1);assert.equal(value(mc,2),1);assert.equal(mc.episode.$,'Nil');
console.log('Both board encodings match 5,478 positions and 16,167 legal transitions each. Seat signs, extra turns, Monte Carlo resets and minimax values passed.');
