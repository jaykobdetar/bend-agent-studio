// Report generation executes trusted archived code; the resulting page does not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execute} from './process_output.mjs';
import {checkedSnapshot,exportCsv,status,unseal,manifestPath} from './experiment.mjs';
import {oracle} from './finite_world.mjs';
import {explainDecisions,publicTraceFrames} from './public_oracle.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function table(head,rows){return '<table><thead><tr>'+head.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
function chart(rows){
  const nums=rows.map(r=>[Number(r.budget),Number(r.estimate),r.ci_low===''?null:Number(r.ci_low),r.ci_high===''?null:Number(r.ci_high)]);
  if(nums.some(a=>a.some(x=>x!==null&&!Number.isFinite(x))))throw Error('invalid analysis coordinates');
  const xmin=Math.min(...nums.map(r=>r[0])),xmax=Math.max(...nums.map(r=>r[0])),ymin=Math.min(...nums.map(r=>r[2]??r[1])),ymax=Math.max(...nums.map(r=>r[3]??r[1]));
  const x=v=>xmin===xmax?230:32+400*(v-xmin)/(xmax-xmin),y=v=>ymin===ymax?65:116-100*(v-ymin)/(ymax-ymin);
  return '<svg role="img" aria-label="Mean return and confidence intervals by checkpoint" viewBox="0 0 464 144"><path d="M32 8V116H432" fill="none" stroke="#555"/><polyline fill="none" stroke="#13598a" points="'+nums.map(([n,v])=>x(n)+','+y(v)).join(' ')+'"/>'+nums.map(([n,v,l,h])=>(l===null||h===null?'':'<line x1="'+x(n)+'" x2="'+x(n)+'" y1="'+y(l)+'" y2="'+y(h)+'" stroke="#00765e"/>')+'<circle cx="'+x(n)+'" cy="'+y(v)+'" r="3" fill="#13598a"/>').join('')+'<text x="32" y="138">'+xmin+'</text><text x="405" y="138">'+xmax+'</text></svg>';
}
export async function writeReport(root,out){
  // Reject a known conflict before analysis/replay. The final wx still protects
  // against a file created after this check.
  if(fs.lstatSync(out,{throwIfNoEntry:false}))throw Error('EEXIST: report destination already exists: '+out);
  const m=unseal(manifestPath(root)),p=m.body.plan;
  checkedSnapshot(root,m);status(root,true);
  if(m.body.toolchain.node!==process.versions.node)throw Error('use archived Node '+m.body.toolchain.node);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bend-report-'));
  try{
    const csv=path.join(tmp,'metrics.csv');fs.writeFileSync(csv,exportCsv(root));
    const body=['<h1>'+esc(p.name)+'</h1><p>Run <code>'+esc(m.hash)+'</code></p>'];
    for(const phase of ['validation','test']){
      body.push('<h2>'+phase+' return</h2>');
      if(!p[phase+'Episodes']){body.push('<p>No episodes in this phase.</p>');continue;}
      const {stdout}=await execute(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),[fileURLToPath(new URL('./analyze.py',import.meta.url)),csv,'--phase',phase]);
      // Analysis dimensions are validated identifier tokens; all other CSV fields
      // for this unpaired invocation are numeric or empty (never quoted commas).
      const [header,...data]=stdout.trimEnd().split(/\r?\n/).map(l=>l.split(','));
      const rows=data.map(r=>Object.fromEntries(header.map((k,i)=>[k,r[i]])));
      for(const game of p.games)for(const arm of p.arms){const subset=rows.filter(r=>r.game===game.id&&r.arm===arm.id);
        if(subset.length)body.push('<h3>'+esc(game.id)+' / '+esc(arm.id)+'</h3>'+chart(subset));}
      body.push(table(header,data));
    }
    let internals,backend,seedOf;
    for(const game of p.games.filter(g=>g.definition)){
      const truth=oracle(game.definition,game.limit);body.push('<h2>'+esc(game.id)+' oracle</h2><p>Full-state optimum: '+esc(truth.optimalFullStateReturn)+'; uniform baseline: '+esc(truth.uniformReturn)+'.</p>');
      if(!p.testEpisodes)continue;
      const load=name=>import(pathToFileURL(path.join(root,'code',name)).href);
      internals??=await load('experiment.mjs');backend??=(await load('backend.mjs')).default;seedOf??=(await load('experiment_config.mjs')).seedOf;
      let best,worst;
      for(const arm of p.arms)for(let rep=0;rep<p.replicates;rep++){
        let previous=null,cp;
        for(const n of p.checkpoints){cp=internals.existing(root,m.hash,{game,arm,rep},n,previous);previous=cp.hash;}
        const runner=internals.gameRunner(backend,game,arm),model=cp.body.model,base=seedOf(p,rep,'test');
        for(let i=0;i<p.testEpisodes;i++){
          const seed=base+i,score=runner.episode({$:'Evaluate'},model,seed,game.limit).score;
          const candidate={arm,runner,model,r:{seed,index:i,replicate:rep,score}};
          if(!best||score>best.r.score)best=candidate;if(!worst||score<worst.r.score)worst=candidate;
        }
      }
      for(const [label,{r,arm,runner,model}] of [['Best',best],['Worst',worst]]){
        const traced=runner.trace({$:'Evaluate'},model,r.seed,game.limit);
        if(traced.report.score!==r.score)throw Error('archived episode and trace scores differ');
        r.frames=internals.unpack(traced.record).map(internals.frameData);
        body.push('<h3>'+label+' test episode</h3><p>'+esc(arm.id)+' · replicate '+esc(r.replicate)+' · episode '+esc(r.index)+' · seed '+esc(r.seed)+' · return '+esc(r.score)+'</p>');
        const frames=publicTraceFrames(game.definition,r.frames,arm.observation);
        const explain=explainDecisions(game.definition,game.limit,frames,{maxBeliefs:20000});
        body.push(table(['Step','Observation','Action','Reward','Optimal public action','Decision gap'],explain.decisions.map((d,i)=>[d.step,d.observation,d.action,frames[i].reward,d.bestAction,d.gap])));
      }
    }
    fs.writeFileSync(out,'<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>'+esc(p.name)+' | Run report</title><style>body{font:16px system-ui;max-width:65rem;margin:2rem auto;padding:0 1rem;color:#152533}svg{max-width:32rem;width:100%}table{border-collapse:collapse;display:block;overflow:auto}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #ccc}h2{margin-top:2em}code{overflow-wrap:anywhere}</style><main>'+body.join('\n')+'</main></html>',{flag:'wx'});
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
