import fs from 'node:fs';
import path from 'node:path';

const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
const files=(root,sub='.')=>fs.readdirSync(path.join(root,sub),{withFileTypes:true})
  .filter(e=>e.isFile()).map(e=>e.name).sort();
const laws=source=>(source.match(/^law\s/gm)??[]).length;
export function inventory(root) {
  const experiments=files(root,'experiments').filter(n=>n.endsWith('.json'));
  const benchmarkFiles=fs.readdirSync(path.join(root,'worlds/benchmarks'),{recursive:true})
    .filter(n=>n.endsWith('.json'));
  const usage=read(root,'core/experiment.mjs').match(/usage: node experiment\.mjs ([^'\n]+)/)?.[1];
  if(!usage)throw Error('core/experiment.mjs: cannot locate CLI usage');
  const commands=[...usage.matchAll(/(?:^| \| )([a-z]+)\s+[A-Z]/g)].map(m=>m[1]);
  return {experiments,commands,counts:{
    'core-laws':laws(read(root,'LAWS.bend')),
    'learner-laws':files(root).filter(n=>n.endsWith('_laws.bend')).reduce((n,f)=>n+laws(read(root,f)),0),
    'experiment-files':experiments.length,
    'benchmark-worlds':benchmarkFiles.filter(n=>Array.isArray(JSON.parse(read(root,path.join('worlds/benchmarks',n))).states)).length
  }};
}

// Documents are repository-relative path -> source; linkedDocs are resolved local link targets.
export function checkInventory({experiments,commands,counts},documents,linkedDocs) {
  const errors=[],seen=new Set();
  for(const [name,src] of documents) {
    for(const m of src.matchAll(/<!-- count:([\w-]+) -->([\s\S]*?)<!-- \/count -->/g)) {
      seen.add(m[1]);
      if(!Object.hasOwn(counts,m[1])||m[2]!==String(counts[m[1]]))
        errors.push(name+': stale or unknown count '+m[1]+' (expected '+(counts[m[1]]??'known marker')+')');
    }
    if(/^docs\/[^/]+\.md$/.test(name)&&!linkedDocs.has(name))errors.push(name+': no inbound documentation link');
  }
  for(const key of Object.keys(counts))if(!seen.has(key))errors.push('missing count marker: '+key);
  const table=(documents.get('EXPERIMENTS.md')??'').split(/^## Choose a manifest or specification\s*$/m)[1]?.split(/^## /m)[0]??'';
  const tokens=new Set([...table.split('\n').filter(line=>line.startsWith('|')).join('\n').matchAll(/`([\w-]+)(?:\.json)?`/g)].map(m=>m[1]));
  for(const name of experiments)if(!tokens.has(name.slice(0,-5)))errors.push('EXPERIMENTS.md: manifest table missing '+name);
  const cmdDoc=documents.get('docs/commands.md')??'';
  for(const cmd of commands)if(!new RegExp('\\bexperiment\\.mjs\\s+'+cmd+'\\b').test(cmdDoc))errors.push('docs/commands.md: undocumented command '+cmd);
  return errors;
}
