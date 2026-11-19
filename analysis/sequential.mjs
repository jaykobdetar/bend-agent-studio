import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Anytime-valid paired mean inference for prospectively ordered training replicates.
// Assumptions: fixed external bounds and a common conditional mean across blocks.
const bets=[1/128,1/64,1/32,1/16,1/8,1/4,1/2,1];

function logMeanWealth(logs) {
  const largest=Math.max(...logs);
  if (!Number.isFinite(largest)) return largest;
  return largest+Math.log(logs.reduce((sum,x)=>sum+Math.exp(x-largest),0)/logs.length);
}

function logFactor(x,m,b) {
  if (b===1) return x===0?-Infinity:Math.log(x)-Math.log(m);
  const ratio=x/m;
  if (!Number.isFinite(ratio)) return Math.log(b)+Math.log(x)-Math.log(m);
  return Math.log1p(b*(ratio-1));
}

export function sequentialEvidence(values,mean,logThreshold=Infinity) {
  if (!Array.isArray(values) || values.some(x=>!Number.isFinite(x)||x<0||x>1) ||
      !Number.isFinite(mean) || mean<0 || mean>1 || !(logThreshold>0)) throw Error('invalid bounded sequence or threshold');
  if (mean===0) {
    const crossed=values.findIndex(x=>x>0);
    return {maxLogEvidence:crossed<0?0:Infinity,firstCrossing:crossed<0?null:crossed+1};
  }
  const logs=bets.map(()=>0);
  let maxLogEvidence=0,firstCrossing=null;
  for (let i=0;i<values.length;i++) {
    for (let j=0;j<bets.length;j++) if(logs[j]!==-Infinity) logs[j]+=logFactor(values[i],mean,bets[j]);
    const current=logMeanWealth(logs);
    maxLogEvidence=Math.max(maxLogEvidence,current);
    if(firstCrossing===null && current>=logThreshold)firstCrossing=i+1;
  }
  return {maxLogEvidence,firstCrossing};
}

export function sequentialPaired(rows,{lower,upper,margin=0,alpha=.05,comparisons=1}) {
  if (!Array.isArray(rows)||![lower,upper,margin,alpha].every(Number.isFinite)||
      upper<=lower||!Number.isFinite(upper-lower)||margin<lower||margin>upper||alpha<=0||alpha>=1||
      !Number.isSafeInteger(comparisons)||comparisons<1) throw Error('invalid paired design');
  const width=upper-lower;
  const differences=rows.map((r,i)=>{
    if (!r || r.replicate!==i || !Number.isFinite(r.candidate)||!Number.isFinite(r.reference)) throw Error('expected contiguous, paired replicate order from zero');
    const d=r.candidate-r.reference;
    if(d<lower||d>upper)throw Error('observed paired improvement lies outside declared bounds');
    return d;
  });
  const values=differences.map(d=>(d-lower)/width),reverse=differences.map(d=>(upper-d)/width);
  const limit=Math.log(2)+Math.log(comparisons)-Math.log(alpha);
  function bound(xs) {
    if (!xs.length || sequentialEvidence(xs,0).maxLogEvidence<limit) return 0;
    let lo=0,hi=1;
    for(let i=0;i<54;i++){
      const m=(lo+hi)/2;
      if(sequentialEvidence(xs,m).maxLogEvidence>=limit)lo=m;else hi=m;
    }
    return lo;
  }
  const positive=sequentialEvidence(values,(margin-lower)/width,limit);
  const negative=sequentialEvidence(reverse,(upper-margin)/width,limit);
  const e=xs=>Math.exp(-xs.maxLogEvidence);
  const difference=rows.length?rows.reduce((mean,r,i)=>mean+((r.candidate-r.reference)-mean)/(i+1),0):null;
  const interval=[lower+width*bound(values),upper-width*bound(reverse)];
  return {replicates:rows.length,meanDifference:difference,confidenceSequence:interval,empty:interval[0]>interval[1],
    threshold:margin,firstAbove:positive.firstCrossing,firstBelow:negative.firstCrossing,
    oneSidedAnytimePAbove:e(positive),oneSidedAnytimePBelow:e(negative),alpha,comparisons};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    if (process.argv.length!==3) throw Error('usage: node analysis/sequential.mjs DESIGN_AND_PAIRED_ROWS.json');
    const {design,rows}=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    console.log(JSON.stringify(sequentialPaired(rows,design),null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
