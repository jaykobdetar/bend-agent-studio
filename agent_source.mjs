import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex');
const sourceName = text => 'agent_'+hash(text).slice(0,32);
const localImport = /^(\s*import\s+)(\.{1,2}\/[\w./-]+\.bend)(\s+as\s+)/gm;

export function bundleAgent(filename, library) {
  const active=new Set(), visited=new Map(), files={};
  function visit(name) {
    const resolved=fs.realpathSync(name);
    if (visited.has(resolved)) return visited.get(resolved);
    if (active.has(resolved)) throw Error('cyclic agent import: '+name);
    active.add(resolved);
    const text=fs.readFileSync(resolved,'utf8').replace(localImport,(_line,before,ref,after)=>{
      const candidate=path.resolve(path.dirname(resolved),ref);
      const standard=path.resolve(library,path.basename(ref));
      const found=fs.existsSync(candidate)?fs.realpathSync(candidate):null;
      if (fs.existsSync(standard) && (found===fs.realpathSync(standard) || (!found && ref==='./'+path.basename(ref)))) {
        return before+'./'+path.basename(ref)+after;
      }
      if (!found) throw Error('missing agent dependency '+ref+' in '+name);
      return before+'./'+visit(found)+'.bend'+after;
    });
    active.delete(resolved);
    const module=sourceName(text);
    files[module+'.bend']=text;
    visited.set(resolved,module);
    return module;
  }
  const entry=visit(filename);
  return {entry,files};
}

export function checkedBundle(bundle) {
  if (!bundle || !bundle.files || typeof bundle.entry!=='string' || !Object.hasOwn(bundle.files,bundle.entry+'.bend')) {
    throw Error('custom agent bundle is missing its entry point');
  }
  for (const [name,src] of Object.entries(bundle.files)) {
    if (typeof src!=='string' || name!==sourceName(src)+'.bend') throw Error('custom agent source hash mismatch');
  }
  return bundle;
}

export function namedParameters(input={}) {
  if (input===null || typeof input!=='object' || Array.isArray(input)) throw Error('parameters must be an object');
  const result={};
  for (const [key,value] of Object.entries(input)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || typeof value!=='number' || !Number.isFinite(Math.fround(value))) {
      throw Error('invalid agent parameter '+key);
    }
    result[key]=Math.fround(value);
  }
  return result;
}

export function parameterList(parameters) {
  let list={$:'Nil'};
  for (const name of Object.keys(parameters).sort().reverse()) {
    list={$:'Con',head:{$:'Parameter',name,value:parameters[name]},tail:list};
  }
  return list;
}
