// Validate every physical action and solve independently via the two-pile theorem.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkedSnapshot,manifestPath,unpack,unseal} from './experiment.mjs';
import {parameterList} from './agent_source.mjs';
import {gameGraph,matchup} from './arena_tournament.mjs';
const root=path.resolve(process.argv[2]),m=unseal(manifestPath(root));checkedSnapshot(root,m);
const api=(await import(pathToFileURL(path.join(root,'code/backend.mjs')).href)).default;
const game=m.body.plan.games.find(g=>g.id==='nim');
for(let left=1;left<=3;left++)for(let right=1;right<=3;right++){
  const world=api[game.world.entry+':world'](parameterList({left,right}));
  const graph=gameGraph(world,left+right);
  assert.equal(graph.nodes[graph.root].height,left+right);
  assert.throws(()=>gameGraph(world,left+right-1),/terminal horizon/);
  const seen=new Set();
  function visit(st){
    const {left:l,right:r,second}=st,k=[l,r,second].join('/');
    if(seen.has(k))return;seen.add(k);
    const view=world.view(st);
    if(!(l+r)){assert.equal(view.$,'End');return;}
    const allowed=[...Array.from({length:l},(_,i)=>i+1),...Array.from({length:r},(_,i)=>i+5)];
    assert.deepEqual(unpack(view.actions),allowed);
    assert.deepEqual(view.observation,{$:'Mover',second,key:4*l+r});
    for(const a of allowed){
      const nl=a<4?l-a:l,nr=a<4?r:r-a+4;
      const next=world.step(st)(a)(0x12345);
      assert.deepEqual(next.fst,{$:'Piles',left:nl,right:nr,second:!second});
      assert.equal(next.snd,nl+nr?0:second?-1:1);visit(next.fst);
    }
  }
  visit(world.reset(99));
  const ideal=graph.nodes.map(({view,edges})=>{
    if(!edges.length)return null;
    const l=Math.floor(view.observation.key/4),r=view.observation.key%4;
    const desired=l>r?l-r:r>l?4+r-l:edges[0].action;
    const i=edges.findIndex(e=>e.action===desired);assert.ok(i>=0);return i;
  });
  const optimal=left===right?-1:1;
  assert.equal(matchup(graph,null,null),optimal);
  assert.equal(matchup(graph,ideal,null),optimal);assert.equal(matchup(graph,null,ideal),optimal);
  if(left===2&&right===3)assert.deepEqual([graph.nodes.length,graph.nodes.reduce((n,x)=>n+x.edges.length,0)],[20,44]);
}
console.log('All nine starting configurations: legal actions, payoffs, horizon and zero exploitability of equalization policy passed.');
