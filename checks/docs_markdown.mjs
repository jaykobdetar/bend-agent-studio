import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ignoredDirs=new Set(['.git','node_modules','.venv','venv','__pycache__']);
const sourceExtension=/\.(?:md|mjs|cjs|js|py|bend|json|toml|yaml|yml|sh|txt|png|svg|html|css)$/i;
const dynamic=s=>/[\$*?{}<>]/.test(s)||/^(?:[A-Z][A-Z0-9_]*)(?:\/|$)/.test(s)||s.startsWith('~')||path.isAbsolute(s);
function filesUnder(root,dir=root) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()?[]:
    e.isDirectory()?(ignoredDirs.has(e.name)?[]:filesUnder(root,path.join(dir,e.name))):
    [path.join(dir,e.name)]);
}
function contained(root,p) {
  const rel=path.relative(root,p); return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));
}
function unescape(s) {
  return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g,'$1')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)));
}
export function slug(text) {
  return unescape(text).replace(/<[^>]*>/g,'').replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g,'$1')
    .replace(/[*`~]/g,'').toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu,'').replace(/\s/g,'-');
}
function stripCode(line) { return line.replace(/(`+).*?\1/g,''); }
function parsedLines(text) {
  const lines=text.split(/\r?\n/);let fence=null;
  return lines.map((text,i)=>{
    const match=text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    const old=fence;
    if(match) {
      if(!fence) fence={char:match[1][0],len:match[1].length,lang:match[2].trim().split(/\s/)[0]};
      else if(match[1][0]===fence.char&&match[1].length>=fence.len&&!match[2].trim())fence=null;
      return {text,line:i+1,marker:true,fence:old??fence};
    }
    return {text,line:i+1,marker:false,fence};
  });
}
export function anchors(text) {
  const found=new Set(),counts=new Map(),lines=parsedLines(text);
  for(let i=0;i<lines.length;i++) {
    const l=lines[i];if(l.fence||l.marker)continue;
    const atx=l.text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const setext=i+1<lines.length&&!lines[i+1].fence&&/^\s{0,3}(?:=+|-+)\s*$/.test(lines[i+1].text)&&l.text.trim();
    if(atx||setext) {const base=slug(atx?atx[1]:l.text.trim());let n=counts.get(base)??0;while(found.has(base+(n?'-'+n:'')))n++;counts.set(base,n+1);found.add(base+(n?'-'+n:''));}
    for(const m of l.text.matchAll(/<(?:a|[a-z][\w-]*)\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi))found.add(m[1]);
  }
  return found;
}
// Balanced inline destinations; title text is excluded. Nested labels work
// because the scanner starts at each actual closing bracket.
function destinations(line) {
  const out=[];
  for(let i=0;i<line.length;i++) {
    if(line[i]!==']'||line[i+1]!=='(')continue;
    let j=i+2;while(/\s/.test(line[j]??'')&&j<line.length)j++;
    if(line[j]==='<') {const end=line.indexOf('>',j+1);if(end>=0)out.push(line.slice(j+1,end));continue;}
    let depth=0,value='';
    for(;j<line.length;j++) {
      const ch=line[j];if(ch==='\\'&&j+1<line.length){value+=ch+line[++j];continue;}
      if(ch==='('){depth++;value+=ch;}
      else if(ch===')'){if(!depth)break;depth--;value+=ch;}
      else if(/\s/.test(ch)&&depth===0)break;
      else value+=ch;
    }
    if(value)out.push(value);
  }
  return out;
}
const refKey=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function shellTokens(line) {
  const out=[];let word='',quote=null;
  for(let i=0;i<line.length;i++) {
    const c=line[i];
    if(c==='\\'&&quote!=="'"&&i+1<line.length){word+=line[++i];continue;}
    if(quote){if(c===quote)quote=null;else word+=c;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='#'&&!word)break;
    if(/\s/.test(c)){if(word){out.push(word);word='';}continue;}
    if('|;&<>'.includes(c)){if(word){out.push(word);word='';}let op=c;if(line[i+1]===c)op+=line[++i];out.push(op);continue;}
    word+=c;
  }
  if(word)out.push(word);return out;
}

export function checkMarkdown(root,options={}) {
  root=fs.realpathSync(root);
  const docs=(options.files??filesUnder(root).filter(p=>p.endsWith('.md')))
    .map(p=>path.resolve(root,p)).sort();
  const issues=[],linkTargets=[],cache=new Map();let generated;
  const inlineAllow=new Set(options.inlineAllow??[]);
  function emit(file,line,code,target,message) {issues.push({file:path.relative(root,file).split(path.sep).join('/'),line,code,target,message});}
  function exists(file,line,ref,base,code) {
    const candidate=path.resolve(base,ref);
    if(!contained(root,candidate)){emit(file,line,'path-outside',ref,'Local reference escapes repository');return null;}
    if(!fs.existsSync(candidate)){emit(file,line,code,ref,'Local path does not exist');return null;}
    if(!contained(root,fs.realpathSync(candidate))){emit(file,line,'path-outside',ref,'Symlink reference escapes repository');return null;}
    return candidate;
  }
  function link(file,line,raw) {
    if(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw))return;
    let name,fragment;try{
      const rawRef=unescape(raw),hash=rawRef.indexOf('#');
      fragment=decodeURIComponent(hash<0?'':rawRef.slice(hash+1));
      name=decodeURIComponent((hash<0?rawRef:rawRef.slice(0,hash)).split('?')[0]);
    }catch{emit(file,line,'link-invalid',raw,'Invalid percent encoding');return;}
    const target=name?exists(file,line,name.replace(/^\//,''),name.startsWith('/')?root:path.dirname(file),'link-missing'):file;
    if(target)linkTargets.push({file:path.relative(root,file),line,target:path.relative(root,target).split(path.sep).join('/'),fragment});
    if(target&&fragment&&/\.md$/i.test(target)) {
      if(!cache.has(target))cache.set(target,anchors(fs.readFileSync(target,'utf8')));
      if(!cache.get(target).has(fragment))emit(file,line,'anchor-missing',raw,'Markdown heading or explicit anchor does not exist');
    }
  }
  function generatedPath(p) {return [...generated].some(g=>typeof g==='string'&&(p===g||p.startsWith(g+'/')));}
  function commandPath(file,line,p,cwd,mandatory=false) {
    if(!p||p.startsWith('-')||dynamic(p)||generatedPath(p))return;
    const candidate=path.resolve(cwd,p);
    if(mandatory||fs.existsSync(candidate)||sourceExtension.test(p))
      exists(file,line,p,cwd,'command-missing');
  }
  for(const file of docs) {
    if(!contained(root,file)||!fs.existsSync(file)){emit(file,1,'document-missing',file,'Requested document does not exist inside repository');continue;}
    const rows=parsedLines(fs.readFileSync(file,'utf8')),refs=new Map();
    for(const row of rows)if(!row.fence&&!row.marker){
      const m=row.text.match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
      if(m)refs.set(refKey(m[1]),m[2]??m[3]);
    }
    generated=new Set(options.generated??['runs']);
    let skip=false,cwd=root,pending='',pendingLine=0,nextCwd=root;
    for(const row of rows) {
      if(skip){skip=false;continue;}
      if(/^\s*<!--\s*docs-check: ignore-next-line\s+\S.+?-->\s*$/.test(row.text)){skip=true;continue;}
      const cwdDirective=row.text.match(/^\s*<!--\s*docs-check: cwd=([^\s]+)\s*-->\s*$/);
      if(cwdDirective){const next=exists(file,row.line,cwdDirective[1],root,'command-missing');if(next)nextCwd=next;continue;}
      if(row.marker){if(row.fence&&['sh','bash','shell','console','zsh'].includes(row.fence.lang)){cwd=nextCwd;nextCwd=root;pending='';}continue;}
      if(row.fence) {
        if(!['sh','bash','shell','console','zsh'].includes(row.fence.lang))continue;
        let line=row.text.replace(/^\s*\$\s+/,'');
        if(!pending)pendingLine=row.line;
        pending+=line.replace(/\\\s*$/,'')+' ';
        if(/\\\s*$/.test(line))continue;
        const tokens=shellTokens(pending);pending='';
        // Track redirection artifacts before validating input arguments.
        tokens.forEach((t,i)=>{if(['>','>>'].includes(t)&&tokens[i+1]&&!dynamic(tokens[i+1]))generated.add(tokens[i+1]);});
        let segment=[];
        function checkCommand(t) {
          while(t.length&&/^[A-Za-z_][\w]*=/.test(t[0]))t.shift();
          if(!t.length)return;
          if(t[0]==='cd'&&t[1]){if(!dynamic(t[1])){const next=exists(file,pendingLine,t[1],cwd,'command-missing');if(next)cwd=next;}return;}
          const cmd=path.basename(t[0]),args=t.slice(1);
          if(cmd==='node'&&args.length>=4&&/experiment\.mjs$/.test(args[0])&&['run','rerun','select','assess'].includes(args[1]))
            generated.add(args[args[1]==='run'||args[1]==='rerun'?3:4]);
          if(cmd==='node'&&args.length>=4&&/batch\.mjs$/.test(args[0])&&['collect','fit','score'].includes(args[1]))
            generated.add(args[args[1]==='score'?6:4]);
          if(/^python(?:[0-9.]+)?$/.test(cmd)&&args[0]==='-m'&&args[1]==='venv'){if(args[2])generated.add(args[2]);return;}
          if(/^(?:node|python[0-9.]*|bend|bash|sh)$/.test(cmd)) {
            if(args[0]==='-m') {for(const flag of ['-r','--requirement','-s','--start-directory']){const r=args.indexOf(flag);if(r>=0)commandPath(file,pendingLine,args[r+1],cwd,true);}return;}
            const script=args.find(x=>!x.startsWith('-'));
            if(script&&!['-e','--eval','-c'].some(x=>args.includes(x)))commandPath(file,pendingLine,script,cwd,true);
            for(const arg of args)if(arg!==script)commandPath(file,pendingLine,arg,cwd);
          } else if(t[0].startsWith('./'))commandPath(file,pendingLine,t[0],cwd,true);
        }
        for(const token of tokens){if(['&&','||',';','|','>','>>','<'].includes(token)){checkCommand(segment);segment=[];}else segment.push(token);}
        checkCommand(segment);continue;
      }
      const line=stripCode(row.text);
      const definition=line.match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
      if(definition)link(file,row.line,definition[2]??definition[3]);
      else {
        for(const d of destinations(line))link(file,row.line,d);
        for(const m of line.matchAll(/\[([^\]]+)\](?:\[([^\]]*)\])?/g)){
          if(line[m.index+m[0].length]==='(')continue;
          const key=refKey(m[2]||m[1]);
          if(refs.has(key))link(file,row.line,refs.get(key));
          else if(m[2]!==undefined&&!/^\d+$/.test(m[1])&&!/^\d+$/.test(m[2]))emit(file,row.line,'reference-missing',key,'Reference-link definition does not exist');
        }
      }
      for(const m of row.text.matchAll(/(`+)([^\n]*?)\1/g)) {
        const token=m[2];
        if(inlineAllow.has(token)||(!sourceExtension.test(token)&&!token.includes('/'))||/\s|[()[\],=]/.test(token)||dynamic(token)||generatedPath(token)||/^[a-z]+:/i.test(token))continue;
        const base=fs.existsSync(path.resolve(root,token))?root:
          fs.existsSync(path.resolve(path.dirname(file),token))?path.dirname(file):root;
        exists(file,row.line,token,base,'inline-missing');
      }
    }
  }
  return {issues,linkTargets};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=process.argv[2]??process.cwd(),{issues}=checkMarkdown(root,{files:process.argv.length>3?process.argv.slice(3):undefined});
  for(const i of issues)console.error(i.file+':'+i.line+' '+i.code+' '+i.target+' — '+i.message);
  console.log(issues.length?'Documentation check failed: '+issues.length+' issue(s).':'Documentation paths and anchors check passed.');
  process.exitCode=issues.length?1:0;
}
