// The endpoint returns data only. Archive names and labels always use textContent.
const palette=['#0d766d','#aa472b','#60469f','#3861a0','#79652a','#a33969','#317b55','#534689'];
const E=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const svg=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
export function comparisonGroups(results,selected) {
  const groups=new Map(),errors=[];
  for(const r of results) {
    if(r.error){errors.push(r.name+': '+r.error);continue;}
    for(const s of r.data.series) {
      if(!selected.has(JSON.stringify([r.id,s.arm])))continue;
      const key=JSON.stringify([s.game,s.gameSpecHash,r.data.budgetUnit]);
      if(!groups.has(key))groups.set(key,{game:s.game,gameSpecHash:s.gameSpecHash,unit:r.data.budgetUnit,lines:[]});
      groups.get(key).lines.push({label:r.name+' · '+s.arm+' · '+r.id.slice(-8),points:s.points});
    }
  }
  return {groups:[...groups.values()],errors};
}
function chart({game,gameSpecHash,unit,lines}) {
  const box=E('section');box.append(E('h4',game+' · '+unit+' · '+gameSpecHash.slice(0,8)));
  const graphic=svg('svg',{viewBox:'0 0 680 220',role:'img','aria-label':game+' validation mean return by '+unit});
  const points=lines.flatMap(l=>l.points);
  const maxX=Math.max(1,...points.map(p=>p.budget)), low=Math.min(...points.map(p=>p.interval?.[0]??p.mean)),
    high=Math.max(...points.map(p=>p.interval?.[1]??p.mean));
  const x=v=>54+610*v/maxX, y=v=> high===low?102:178-150*(v-low)/(high-low);
  for(const [a,b,c,d] of [[54,20,54,178],[54,178,664,178]])graphic.append(svg('line',{x1:a,y1:b,x2:c,y2:d,stroke:'currentColor'}));
  const tag=(a,b,t)=>{const e=svg('text',{x:a,y:b,fill:'currentColor','font-size':12});e.textContent=t;graphic.append(e);};
  tag(2,30,Number(high.toPrecision(3)));tag(2,178,Number(low.toPrecision(3)));tag(54,200,'0');tag(614,200,maxX);tag(260,216,'Training budget ('+unit+')');
  const legend=E('ul');
  for(const [i,l] of lines.entries()) {
    const color=palette[i%palette.length], pts=l.points;
    if(pts.every(p=>p.interval)) {
      const poly=[...pts.map(p=>[x(p.budget),y(p.interval[1])]),...[...pts].reverse().map(p=>[x(p.budget),y(p.interval[0])])];
      graphic.append(svg('polygon',{points:poly.map(v=>v.join(',')).join(' '),fill:color,opacity:0.16}));
    }
    graphic.append(svg('polyline',{points:pts.map(p=>x(p.budget)+','+y(p.mean)).join(' '),fill:'none',stroke:color,'stroke-width':2}));
    for(const p of pts) graphic.append(svg('circle',{cx:x(p.budget),cy:y(p.mean),r:3,fill:color}));
    const el=E('li',l.label+' · '+pts[0].replicates+' replicate(s)');el.style.borderLeft='4px solid '+color;legend.append(el);
  }
  box.append(graphic,legend);
  const details=E('details');details.append(E('summary','Exact validation points'));
  const table=E('table'), head=E('tr');for(const title of ['Run / arm','Budget','Mean','95% interval'])head.append(E('th',title));table.append(head);
  for(const line of lines)for(const p of line.points){const row=E('tr');for(const val of [line.label,p.budget,p.mean,p.interval?p.interval.join(' to '):'Unavailable'])row.append(E('td',String(val)));table.append(row);}
  details.append(table);box.append(details);return box;
}
export function comparisonUI(container,api) {
  const selected=new Set(), form=E('fieldset'), legend=E('legend','Runs and agents'), go=E('button','Compare validation'), output=E('div');
  const limit=8;let runs=[],generation=0,lastList;
  output.setAttribute('aria-live','polite');go.className='secondary';form.append(legend);container.append(form,go,output);
  go.onclick=async()=>{
    const epoch=++generation;go.disabled=true;
    output.replaceChildren(E('p','Reading validation checkpoints…'));
    const chosen=runs.filter(r=>r.arms.some(a=>selected.has(JSON.stringify([r.id,a]))));
    const results=[];
    // Do not compete with our own selection for the server's bounded readers.
    for(const r of chosen) {
      if(epoch!==generation)return;
      try{results.push({...r,data:await api('/api/runs/'+r.id+'/summary')});}
      catch(err){results.push({...r,error:err.message});}
    }
    if(epoch!==generation)return;
    const {groups,errors}=comparisonGroups(results,selected);
    output.replaceChildren(...errors.map(e=>E('p','Skipped '+e)),...groups.map(chart));
    go.disabled=!selected.size;
  };
  return all=>{
    runs=all.filter(r=>r.status==='ready');
    const list=JSON.stringify(runs.map(r=>[r.id,r.name,r.arms]));if(list===lastList)return;lastList=list;
    const valid=new Set(runs.flatMap(r=>r.arms.map(a=>JSON.stringify([r.id,a]))));
    for(const k of selected)if(!valid.has(k))selected.delete(k);
    const entries=[];
    for(const r of runs)for(const a of r.arms){
      const k=JSON.stringify([r.id,a]),label=E('label'),input=E('input');input.type='checkbox';input.checked=selected.has(k);
      input.onchange=()=>{generation++;if(input.checked && selected.size>=limit){input.checked=false;output.replaceChildren(E('p','Compare at most eight series selections.'));}else{if(input.checked)selected.add(k);else selected.delete(k);output.replaceChildren();}go.disabled=!selected.size;};
      label.append(input,document.createTextNode(' '+r.name+' · '+a));entries.push(label);
    }
    form.replaceChildren(legend,...(entries.length?entries:[E('p','No ready runs to compare.')]));
    go.disabled=!selected.size;
  };
}
