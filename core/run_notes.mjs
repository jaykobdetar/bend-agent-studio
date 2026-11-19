// Mutable, local display metadata. Never trusted as provenance or instructions.
import fs from 'node:fs';
import path from 'node:path';
const limit=16384;
export function readRunNotes(root){
  const file=path.join(root,'notes.json');
  let fd;
  try {
    const before=fs.lstatSync(file);
    if(!before.isFile()||before.size>limit)throw Error();
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
    const actual=fs.fstatSync(fd);
    if(!actual.isFile()||actual.size>limit||actual.dev!==before.dev||actual.ino!==before.ino)throw Error();
    const buf=Buffer.alloc(limit+1);let n=0;
    while(n<buf.length){const k=fs.readSync(fd,buf,n,buf.length-n,null);if(!k)break;n+=k;}
    if(n>limit)throw Error();
    const x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(0,n)));
    if(!x||Array.isArray(x)||typeof x!=='object'||Object.keys(x).some(k=>!['notes','tags'].includes(k)))throw Error();
    const {notes='',tags=[]}=x;
    if(typeof notes!=='string'||notes.length>4096||!Array.isArray(tags)||tags.length>16||
        tags.some(t=>typeof t!=='string'||!t.trim()||t.length>64||/[\x00-\x1f\x7f]/.test(t)))throw Error();
    return {annotations:{notes,tags}};
  } catch(e){return e.code==='ENOENT'?{}:{annotationWarning:'Run notes unavailable or invalid.'};}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
