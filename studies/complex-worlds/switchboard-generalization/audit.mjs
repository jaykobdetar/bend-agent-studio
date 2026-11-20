// Exact policy scoring under uniform independent cue masks and query IDs.
// Only use a trusted run produced by plan.json. Never score an untrusted backend.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {archive} from '../../../offline/dataset.mjs';
import {adapterName, existing, gameRunner, unpack} from '../../../core/experiment.mjs';
import {seedOf} from '../../../core/experiment_config.mjs';

const width=16,masks=2**width,contexts=masks*width,radix=50;
const queryFirst=33,legal={$:'Con',head:0,tail:{$:'Con',head:1,tail:{$:'Nil'}}};
const {fround:F,imul}=Math;
const view=(mask,q)=>radix*mask+queryFirst+q;
function answer(game,mask,q) {
  if (game==='direct') return mask>>>q&1;
  assert.equal(game,'remapped');
  return (mask>>>((5*q+3)&15)&1)^Number(q%4===1 || q%4===2);
}
function mix(x) {
  x=imul(x^(x>>>16),2246822507);
  x=imul(x^(x>>>13),3266489909);
  return (x^(x>>>16))>>>0;
}
const advance = x => (imul(x,1664525)+1013904223)>>>0;
function seededView(seed) {
  let s=seed,m=mix(s^3266489917)>>>31;
  for(let bit=1;bit<width;bit++){
    s=advance(advance(s));
    m|=(mix(s^2779096485)>>>31)<<bit;
  }
  s=advance(advance(s));
  return view(m,mix(s^2779096485)>>>28);
}

function tabularPolicy(model,seen) {
  const values=new Map();
  let todo=model.values;
  if(todo.$==='Con'){
    assert.equal(todo.head.$,'Indexed');
    assert.equal(todo.tail.$,'Nil');
    const nodes=[todo.head.tree];
    while(nodes.length) {
      const n=nodes.pop();
      if(n.$==='Vacant')continue;
      assert.equal(n.$,'Node');
      if(n.a!==2){
        assert(n.a===0||n.a===1);
        assert(seen.has(n.s));
        if(!values.has(n.s))values.set(n.s,[0,0]);
        assert.equal(values.get(n.s)[n.a],0);
        values.get(n.s)[n.a]=n.cell.value;
      }
      nodes.push(n.lo,n.hi);
    }
  } else assert.equal(todo.$,'Nil');
  assert.equal(values.size,seen.size);
  return (m,q,obs=view(m,q))=>{const v=values.get(obs);return Number(v!==undefined&&v[1]>v[0]);};
}
function weight(tree,action,feature) {
  // The existing sparse linear implementation walks action then feature bits,
  // each low-to-high, and stores the scalar in the row's left slot.
  for(const key of [action,feature])for(let i=0;i<32;i++){
    if(tree.$==='Vacant')return 0;
    assert.equal(tree.$,'Branch');
    tree=(key>>>i&1)?tree.high:tree.low;
  }
  if(tree.$==='Vacant')return 0;
  assert.equal(tree.$,'Leaf');
  assert(Number.isFinite(tree.row.left));
  return tree.row.left;
}
function weights(model) {
  assert.equal(model.$,'CueLinear');
  const n=model.use_bits?17:1;
  return Array.from({length:width},(_,q)=>
    [0,1].map(a=>Array.from({length:n},(_,f)=>weight(model.linear.weights,a,17*q+f))));
}
function linearPolicy(rows,m,q) {
  let a=0,b=0;
  const [w0,w1]=rows[q];
  for(let j=w0.length-1;j>=1;j--){
    const positive=m>>>(j-1)&1;
    a=F(a+(positive?w0[j]:-w0[j]));
    b=F(b+(positive?w1[j]:-w1[j]));
  }
  return Number(F(w1[0]+b)>F(w0[0]+a));
}
function exactLinear(game,rows) {
  let correct=0,cross=0;
  for(let q=0;q<width;q++){
    const [a,b]=rows[q], other=game==='direct'?'remapped':'direct';
    const visit=(bit,m,sum0,sum1)=>{
      if(bit<0){
        const action=Number(F(a[0]+sum0)<F(b[0]+sum1));
        if(answer(game,m,q)===action)correct++;
        if(answer(other,m,q)===action)cross++;
      } else {
        visit(bit-1,m,F(sum0-a[bit+1]),F(sum1-b[bit+1]));
        visit(bit-1,m|(1<<bit),F(sum0+a[bit+1]),F(sum1+b[bit+1]));
      }
    };
    visit(width-1,0,0,0);
  }
  return [correct,cross];
}

const run=path.resolve(process.argv[2]??'');
const details=process.argv[3]==='--rows';
if (process.argv.length!==(details?4:3)) throw Error('usage: node audit.mjs <trusted complete run> [--rows]');
const {api,manifest,plan}=await archive(run),results=[];
assert.deepEqual(plan.games.map(g=>g.id),['direct','remapped']);
assert.deepEqual(plan.arms.map(a=>a.id),['tabular','query-only','cue-linear']);
let policyChecks=0,traceChecks=0;
for(let rep=0;rep<plan.replicates;rep++){
  const first=seedOf(plan,rep,'train'), seen=new Set();
  const contextsAt=new Map(); let i=0;
  for(const n of plan.checkpoints){
    while(i<n)seen.add(seededView(first+i++));
    contextsAt.set(n,new Set(seen));
  }
  for(const game of plan.games)for(const arm of plan.arms){
    const native=api['preferred_'+adapterName(game,arm)],runner=gameRunner(api,game,arm);
    let parent=null;
    for(const n of plan.checkpoints){
      const known=contextsAt.get(n),cp=existing(run,manifest.hash,{game,arm,rep},n,parent);
      assert(cp);parent=cp.hash;
      const b=cp.body, model=b.model;
      assert.equal(b.train.episodes,n);assert.equal(b.train.steps,n*17);
      assert.equal(b.train.terminal,n);assert.equal(b.train.illegal,0);
      const rows=arm.id==='tabular'?null:weights(model);
      const predict=rows?((m,q)=>linearPolicy(rows,m,q)):tabularPolicy(model,known);
      let rightOnSeen=0, switched=0;
      for(const obs of known){
        const m=Math.floor(obs/radix),q=obs%radix-queryFirst,actual=answer(game.id,m,q);
        const a=predict(m,q,obs);
        rightOnSeen+=Number(a===actual);
        if(a)switched+=2*actual-1;
      }
      // Unseen tabular contexts choose 0. The query-only predictor is constant
      // across a query's masks, exactly half of which have each target value.
      const [totalRight,crossRight]=arm.id==='cue-linear'?exactLinear(game.id,rows):
        [contexts/2+(arm.id==='tabular'?switched:0),null];
      assert(totalRight>=rightOnSeen && totalRight-rightOnSeen<=contexts-known.size);
      // Compare archived compiled policies to the independent F32/legal-order
      // interpreter, including all positions, empty/full and varied masks.
      for(let q=0;q<width;q++)for(const m of [0,masks-1,1<<q,...Array.from({length:9},(_,j)=>mix(42+1000*rep+100*j+q+n)&65535)]){
        assert.equal(native(model,view(m,q),legal),predict(m,q));
        policyChecks++;
      }
      if(n===0||n===plan.checkpoints.at(-1)){
        for(const s of [first,first+1,seedOf(plan,rep,'validation'),seedOf(plan,rep,'test')]){
          const traced=runner.trace({$:'Evaluate'},model,s,game.limit);
          const fs=unpack(traced.record), last=fs.at(-1);
          assert.equal(fs.length,17); assert.equal(last.observation,seededView(s)); assert.deepEqual(last.legal,legal);assert.equal(last.next.$,'End');
          for(let j=0;j<16;j++){
            assert.equal(fs[j].action,2);assert.equal(fs[j].reward,0);
          }
          const actual=answer(game.id,Math.floor(last.observation/radix),last.observation%radix-queryFirst);
          assert.equal(last.reward,last.action===actual?1:-1);
          traceChecks++;
        }
      }
      results.push({game:game.id,arm:arm.id,rep,n,seen:known.size,exactAccuracy:totalRight/contexts,
        novelAccuracy:(totalRight-rightOnSeen)/(contexts-known.size),crossMappingAccuracy:crossRight===null?null:crossRight/contexts,
        validationAccuracy:(1+b.validation.mean)/2,testAccuracy:b.test?(1+b.test.mean)/2:null,
        checkpointBytes:fs.statSync(path.join(run,'trials',game.id,arm.id,String(rep),n+'.json')).size});
    }
  }
}
if(details) console.log(JSON.stringify({contexts,policyChecks,traceChecks,results},null,2));
else {
  const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
  const digits=x=>Number(x.toFixed(8));
  const groups=[];
  for(const g of plan.games)for(const n of plan.checkpoints)for(const a of plan.arms){
    const rows=results.filter(r=>r.game===g.id&&r.n===n&&r.arm===a.id);
    const avg=field=>rows[0][field]===null?null:digits(mean(rows.map(r=>r[field])));
    const lower=Math.min(...rows.map(r=>r.exactAccuracy)),upper=Math.max(...rows.map(r=>r.exactAccuracy));
    const row={game:g.id,arm:a.id,episodes:n,replicates:rows.length,
      exactAccuracy:avg('exactAccuracy'),exactRange:[digits(lower),digits(upper)],
      novelAccuracy:avg('novelAccuracy'),meanUniqueTrainingContexts:avg('seen'),
      crossMappingAccuracy:avg('crossMappingAccuracy'),
      validationAccuracy:avg('validationAccuracy'),testAccuracy:avg('testAccuracy'),
      meanCheckpointBytes:avg('checkpointBytes')};
    if(a.id==='cue-linear'){
      const q=results.filter(r=>r.game===g.id&&r.n===n&&r.arm==='tabular');
      assert.equal(rows.length,8);assert.equal(q.length,8);
      const d=rows.map((r,i)=>{assert.equal(r.rep,q[i].rep);return r.exactAccuracy-q[i].exactAccuracy;});
      const m=mean(d),margin=2.3646242510103*Math.sqrt(d.reduce((s,v)=>s+(v-m)**2,0)/(d.length-1)/d.length);
      row.pairedExactGainOverTabular={mean:digits(m),t95:[digits(m-margin),digits(m+margin)]};
    }
    groups.push(row);
  }
  console.log(JSON.stringify({contexts,policyChecks,traceChecks,groups},null,2));
}
