// Keep potentially large checkpoint chains and bootstrap work off the HTTP loop.
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {validationSummary} from './validation-summary.mjs';
if(!isMainThread) {
  try {parentPort.postMessage({value:validationSummary(workerData)});}
  catch {parentPort.postMessage({error:'The checkpoint data is incomplete, damaged, unsupported, or exceeds the comparison limits.'});}
}
const active=new Set();
export function readSummary(dir,res) {
  if(active.size>=2)throw Object.assign(Error('Two comparisons are being read. Try again shortly.'),{status:429});
  const worker=new Worker(new URL(import.meta.url),{workerData:dir,resourceLimits:{maxOldGenerationSizeMb:256}});
  active.add(worker);
  return new Promise((resolve,reject)=>{
    const stop=()=>{void worker.terminate();};
    const timer=setTimeout(stop,20000);
    res.once('close',stop);
    let reply;worker.once('message',message=>{reply=message;});
    worker.once('error',()=>{reply={error:'The checkpoint reader could not complete.'};});
    worker.once('exit',code=>{
      active.delete(worker);clearTimeout(timer);res.off('close',stop);
      if(code===0 && reply?.value)resolve(reply.value);
      else reject(Object.assign(Error(reply?.error??'The checkpoint reader stopped before completion.'),{status:422}));
    });
  });
}
