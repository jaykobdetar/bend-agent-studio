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
  const learners=fs.readdirSync(path.join(root,'agents'),{withFileTypes:true})
    .filter(e=>e.isDirectory() && files(root,path.join('agents',e.name)).includes('laws.bend'));
  const commands=[...usage.matchAll(/(?:^| \| )([a-z]+)\s+[A-Z]/g)].map(m=>m[1]);
  return {experiments,commands,counts:{
    'core-laws':laws(read(root,'laws/LAWS.bend')),
    'learner-laws':learners.reduce((n,e)=>n+laws(read(root,path.join('agents',e.name,'laws.bend'))),0),
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
    // Compatibility stubs preserve external bookmarks even when all internal links use the new guide.
    const moved=src.match(/^<!-- moved-to: (agents\/[a-z_]+\/README\.md) -->$/m)?.[1];
    const stub=/^docs\/[^/]+\.md$/.test(name) && moved && documents.has(moved) && src.includes('](../'+moved+')');
    if((/^docs\/[^/]+\.md$/.test(name)||/^agents\/[^/]+\/README\.md$/.test(name))&&!stub&&!linkedDocs.has(name))
      errors.push(name+': no inbound documentation link');
  }
  for(const key of Object.keys(counts))if(!seen.has(key))errors.push('missing count marker: '+key);
  const table=(documents.get('docs/experiments.md')??'').split(/^## Choose a manifest or specification\s*$/m)[1]?.split(/^## /m)[0]??'';
  const tokens=new Set([...table.split('\n').filter(line=>line.startsWith('|')).join('\n').matchAll(/`([\w-]+)(?:\.json)?`/g)].map(m=>m[1]));
  for(const name of experiments)if(!tokens.has(name.slice(0,-5)))errors.push('docs/experiments.md: manifest table missing '+name);
  const cmdDoc=documents.get('docs/commands.md')??'';
  for(const cmd of commands)if(!new RegExp('\\bexperiment\\.mjs\\s+'+cmd+'\\b').test(cmdDoc))errors.push('docs/commands.md: undocumented command '+cmd);
  return errors;
}
