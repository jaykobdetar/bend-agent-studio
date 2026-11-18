import {runPlan} from '../experiment.mjs';
import {guardedPlan} from './authoring.mjs';
import {context} from './context.mjs';
try {
  const [workspace,plan,out,...options]=process.argv.slice(2),ctx=context(workspace);
  await runPlan(guardedPlan(plan,ctx),out,options);
}catch(e){console.error(e.message);process.exitCode=1}
