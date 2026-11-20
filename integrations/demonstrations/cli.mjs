import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {knownGridLayouts} from '../../studio/grid-layouts.mjs';
import {loadFiniteWorld} from '../finite-session.mjs';
import {display} from './display.mjs';
import {encode, recorder, verify} from './recording.mjs';
import {portablePolicy} from './policy.mjs';
import {MAX_DEMOS, train} from './train.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Usage (local only):
  node integrations/demonstrations/cli.mjs play WORLD OUT.json [--seed 1] [--limit 64]
  node integrations/demonstrations/cli.mjs label WORLD FIT.json OUT.json [--seed 2]
  node integrations/demonstrations/cli.mjs verify WORLD DEMO.json
  node integrations/demonstrations/cli.mjs watch WORLD FIT.json [--seed 1000]
  node integrations/demonstrations/cli.mjs fit WORLD OUT.json DEMO.json [...] [--eval-seed 1000] [--episodes 32]`;

function integer(s, name) {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s) || !Number.isSafeInteger(Number(s)))
    throw Error('expected nonnegative integer for ' + name);
  return Number(s);
}
function read(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 4 * 2 ** 20)
    throw Error('expected a demonstration file no larger than 4 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function write(file, value) {
  const bytes = encode(value);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = path.join(path.dirname(file), '.' + randomUUID() + '.tmp');
  fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
  try {
    fs.linkSync(temporary, file);
  } finally {
    fs.unlinkSync(temporary);
  }
}
function summary(ep) {
  return (
    ep.inputMode +
    ' | seed ' +
    ep.seed +
    ' | ' +
    ep.frames.length +
    '/' +
    ep.limit +
    ' steps | ' +
    ep.reason +
    ' | return ' +
    ep.score
  );
}

function layoutFor(world) {
  return world.grid ? undefined : knownGridLayouts(root).get('scene_' + world.sha256.slice(0, 20));
}
async function play(world, output, seed, limit, controller = null) {
  const mode =
    process.stdin.isTTY && process.stdout.isTTY ? 'interactive-terminal' : 'scripted-input';
  const session = recorder(world, seed, limit, mode, controller);
  const layout = layoutFor(world);
  const input = createInterface({input: process.stdin, terminal: false, historySize: 0});
  function screen() {
    console.log(display(world, layout, session.done ? {...session.view, legal: []} : session.view));
    if (session.done) {
      console.log(
        summary(session.finish().episode) +
          '\nType save to write the episode, review to see actions, or quit to discard.',
      );
    } else if (controller)
      console.log(
        'Clone will play ' +
          session.proposed +
          '. Type the action YOU recommend, same, skip, review or quit:',
      );
    else console.log('Type an action ID, review, or quit:');
  }
  try {
    if (controller)
      console.log('Teaching on learner states: the clone drives. Labels do not change this run.');
    console.log(
      'Local demonstration | ' +
        mode +
        ' | seed ' +
        seed +
        ' | horizon ' +
        limit +
        '\nNothing is saved until you finish and type save.',
    );
    screen();
    for await (const line of input) {
      const value = line.trim().toLowerCase();
      if (value === 'quit') break;
      if (value === 'review') {
        console.log(
          'Accepted actions: [' + session.actions().join(', ') + '] | return ' + session.score,
        );
        if (controller)
          console.log(
            'Teacher labels: [' +
              session
                .labels()
                .map((a) => a ?? 'skip')
                .join(', ') +
              ']',
          );
        screen();
        continue;
      }
      if (value === 'save' && session.done) {
        const record = session.finish();
        verify(world, record);
        write(output, record);
        console.log('Saved replay-verified demonstration: ' + output);
        return;
      }
      if (value === 'save') {
        console.log('Save is available after the episode finishes.');
        continue;
      }
      const label =
        controller && value === 'skip'
          ? null
          : controller && value === 'same'
            ? session.proposed
            : /^(0|[1-9][0-9]*)$/.test(value)
              ? Number(value)
              : undefined;
      if (session.done || (label !== null && !session.view.legal.includes(label))) {
        console.log(
          session.done
            ? 'Episode complete; choose save, review or quit.'
            : 'No move recorded; enter a listed action ID.',
        );
        continue;
      }
      const f = session.step(label);
      console.log(
        'Step ' +
          session.steps +
          ' | action ' +
          f.action +
          ' | reward ' +
          f.reward +
          ' | return ' +
          session.score,
      );
      screen();
    }
    console.log('Discarded; no file written.');
  } finally {
    input.close();
  }
}

export async function main(argv) {
  const [command, ...args] = argv;
  if (command === '--help' || command === 'help') {
    console.log(usage);
    return;
  }
  const optionNames = ['watch', 'label'].includes(command)
    ? ['seed']
    : command === 'play'
      ? ['seed', 'limit']
      : command === 'fit'
        ? ['eval-seed', 'episodes']
        : [];
  const {values, positionals: p} = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(optionNames.map((s) => [s, {type: 'string'}])),
  });
  if (
    !['play', 'verify', 'fit', 'watch', 'label'].includes(command) ||
    (command === 'fit'
      ? p.length < 3 || p.length > MAX_DEMOS + 2
      : p.length !== (command === 'label' ? 3 : 2))
  )
    throw Error(usage);
  const [file, out, ...inputs] = p;
  const world = loadFiniteWorld(file);
  if (command === 'verify') {
    const ep = verify(world, read(out));
    console.log('Replay verified: ' + summary(ep));
    return;
  }
  if (command === 'watch') {
    const fit = read(out),
      action = portablePolicy(world, fit);
    const seed = integer(values.seed ?? '1000', 'seed');
    const session = recorder(world, seed, fit.limit, 'scripted-input');
    const layout = layoutFor(world);
    console.log('Fitted clone | seed ' + seed + ' | automatic playback; nothing recorded.');
    while (!session.done) {
      console.log(display(world, layout, session.view));
      const f = session.step(action(session.view));
      console.log(
        'Clone played ' + f.action + ' | reward ' + f.reward + ' | return ' + session.score,
      );
    }
    console.log(display(world, layout, {...session.view, legal: []}));
    console.log(
      session.finish().episode.reason + ' | ' + session.steps + ' steps | return ' + session.score,
    );
    return;
  }
  if (command === 'label') {
    if (fs.existsSync(inputs[0])) throw Error('output already exists: ' + inputs[0]);
    const controller = read(out);
    await play(world, inputs[0], integer(values.seed ?? '2', 'seed'), controller.limit, controller);
    return;
  }
  if (fs.existsSync(out)) throw Error('output already exists: ' + out);
  if (command === 'play') {
    await play(
      world,
      out,
      integer(values.seed ?? '1', 'seed'),
      integer(values.limit ?? '64', 'limit'),
    );
    return;
  }
  // Bound aggregate input before loading into memory, not only individual files.
  let total = 0;
  const records = inputs.map((name) => {
    total += fs.statSync(name).size;
    if (total > 16 * 2 ** 20) throw Error('demonstrations exceed 16 MiB total input');
    return read(name);
  });
  const fit = await train(
    world,
    records,
    integer(values['eval-seed'] ?? '1000', 'eval-seed'),
    integer(values.episodes ?? '32', 'episodes'),
  );
  write(out, fit);
  const {training: t, evaluation: e} = fit;
  console.log(
    t.labels +
      ' ' +
      fit.inputMode +
      ' labels | fit agreement ' +
      t.matches +
      '/' +
      t.labels +
      '\n' +
      e.episodes +
      ' fresh paired simulator episodes | untrained mean ' +
      e.untrainedMean +
      ' | clone mean ' +
      e.cloneMean +
      ' | gain ' +
      e.meanPairedGain +
      '\nSaved data-only policy and paired returns: ' +
      out,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
