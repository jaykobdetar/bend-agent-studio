import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {knownGridLayouts} from '../../studio/grid-layouts.mjs';
import {loadFiniteWorld} from '../finite-session.mjs';
import {actionInput, actionText, display, isKart} from './display.mjs';
import {encode, recorder, verify} from './recording.mjs';
import {portablePolicy} from './policy.mjs';
import {MAX_DEMOS, train} from './train.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Teach a policy by playing a finite world. Input is turn-based and stays local.
Try your first drive:
  npm run teach -- play worlds/challenges/apex-kart/kart-sprint.json runs/my-drive.json --seed 1 --limit 32

Usage:
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
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw Error('Invalid JSON in ' + file + '. Use a saved recording or fit report.');
    throw error;
  }
}
function write(file, value) {
  const bytes = encode(value);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = path.join(path.dirname(file), '.' + randomUUID() + '.tmp');
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, bytes);
    } finally {
      fs.closeSync(fd);
    }
    fs.linkSync(temporary, file);
  } finally {
    fs.unlinkSync(temporary);
  }
}
function outputExists(file) {
  return Error('Output already exists: ' + file + '\nKeep that file and choose a new output path.');
}
function saveError(error, file) {
  if (error.code === 'EEXIST' && fs.existsSync(file)) return outputExists(file).message;
  if (error.code === 'ENOSPC') return 'No disk space to save ' + file + '.';
  return 'Could not save ' + file + ': ' + error.message;
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
  const name = (a) => actionText(world, layout, a);
  const input = createInterface({input: process.stdin, terminal: false, historySize: 0});
  let failedSave = false;

  function screen() {
    console.log(display(world, layout, session.done ? {...session.view, legal: []} : session.view));
    if (session.done) {
      const {episode} = session.finish();
      const end =
        episode.reason === 'Limit'
          ? 'Turn limit reached; you can save this run even though the world did not finish.'
          : 'Episode complete.';
      console.log(end + '\n' + summary(episode));
      if (!session.steps || (controller && session.labels().every((a) => a === null)))
        console.log('No training labels were recorded in this episode.');
      console.log('save = write to ' + output + ' | review = inspect | quit = discard');
    } else if (controller) {
      console.log(
        'Clone will play ' +
          name(session.proposed) +
          '. Recommend an action, or type same, skip, help, review, or quit:',
      );
    } else console.log('Enter a listed action and press Return. Type help, review, or quit:');
  }

  function help() {
    const inputs = isKart(layout) || world.grid ? 'Enter its number or name.' : 'Enter its number.';
    console.log(
      (controller
        ? 'The clone drives. Recommend a listed action, or use same to endorse or skip for no label. ' +
          inputs
        : 'You choose the action each turn. ' + inputs) +
        '\nreview shows what is in memory. quit discards it.' +
        '\nWhen the episode ends: save writes to the path shown, or save PATH writes to another path. Existing files are never overwritten.',
    );
    if (isKart(layout))
      console.log(
        'Track readout: . straight, l/r sweepers, L/R hairpins. Slow for tight corners or take the inside lane. Steering alone keeps your speed.',
      );
  }

  try {
    console.log(
      controller
        ? 'Coach the clone. It drives; your labels only teach the next version.'
        : 'Drive one episode. Each action advances one turn.',
    );
    console.log('Input: ' + mode + ' | seed ' + seed + ' | up to ' + limit + ' turns');
    console.log('Nothing is written until you finish and type save. Planned file: ' + output);
    if (isKart(layout) && !controller)
      console.log(
        'Try throttle on a straight. Brake before a hairpin, or move to its inside lane.',
      );
    screen();
    for await (const line of input) {
      const raw = line.trim();
      const value = raw.toLowerCase();
      if (value === 'quit') {
        console.log('Discarded; no file written.');
        return;
      }
      if (value === 'help') {
        help();
        screen();
        continue;
      }
      if (value === 'review') {
        console.log(
          'Accepted actions: [' + session.actions().join(', ') + '] | return ' + session.score,
        );
        if (controller)
          console.log(
            'Teacher labels: [' +
              session
                .labels()
                .map((a) => (a === null ? 'skip' : name(a)))
                .join(', ') +
              '] (not applied)',
          );
        screen();
        continue;
      }
      if (/^save(?:\s|$)/.test(value)) {
        if (!session.done) {
          console.log(
            'This episode is still in progress. Finish it before saving, or type quit to discard.',
          );
          continue;
        }
        const destination = raw.slice(4).trim() || output;
        const record = session.finish();
        verify(world, record);
        try {
          write(destination, record);
        } catch (error) {
          failedSave = true;
          console.error(saveError(error, destination));
          console.log(
            'Your completed episode is still in memory. Try save again, type save PATH, or quit to discard.',
          );
          continue;
        }
        console.log(
          (controller
            ? 'Saved replay-verified coaching labels: '
            : 'Saved replay-verified demonstration: ') + destination,
        );
        if (session.steps && (!controller || session.labels().some((a) => a !== null)))
          console.log(
            controller
              ? 'Next: run teach fit with the original recordings and this new label file.'
              : 'Next: run teach fit with this recording, then teach watch to see the clone drive.',
          );
        return;
      }
      const label =
        controller && value === 'skip'
          ? null
          : controller && value === 'same'
            ? session.proposed
            : actionInput(world, layout, session.view.legal, value);
      if (session.done || (label !== null && !session.view.legal.includes(label))) {
        console.log(
          session.done
            ? 'Episode complete. Type save, review, help, or quit.'
            : (controller ? 'No label or turn recorded. ' : 'No move recorded. ') +
                'Choose: ' +
                session.view.legal.map(name).join(' | ') +
                (controller ? ' | same | skip' : ''),
        );
        continue;
      }
      const f = session.step(label);
      console.log(
        'Turn ' +
          session.steps +
          '/' +
          limit +
          (controller
            ? ' | clone played ' +
              name(f.action) +
              ' | your label: ' +
              (label === null ? 'skipped' : name(label))
            : ' | played ' + name(f.action)) +
          ' | reward ' +
          f.reward +
          ' | return ' +
          session.score,
      );
      if (isKart(layout) && f.reward < 0)
        console.log('Ran onto gravel: the kart lost speed and moved to the outside.');
      screen();
    }
    console.log('Input closed. Discarded; no file written.');
    if (failedSave) process.exitCode = 1;
  } finally {
    input.close();
  }
}

export async function main(argv) {
  const [command, ...args] = argv;
  if (
    !command ||
    command === '--help' ||
    command === 'help' ||
    (args.length === 1 && args[0] === '--help')
  ) {
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
        'Clone played ' +
          actionText(world, layout, f.action) +
          ' | reward ' +
          f.reward +
          ' | return ' +
          session.score,
      );
    }
    console.log(display(world, layout, {...session.view, legal: []}));
    console.log(
      session.finish().episode.reason + ' | ' + session.steps + ' steps | return ' + session.score,
    );
    return;
  }
  if (command === 'label') {
    if (fs.existsSync(inputs[0])) throw outputExists(inputs[0]);
    const controller = read(out);
    await play(world, inputs[0], integer(values.seed ?? '2', 'seed'), controller.limit, controller);
    return;
  }
  if (fs.existsSync(out)) throw outputExists(out);
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
  try {
    write(out, fit);
  } catch (error) {
    throw Error(saveError(error, out));
  }
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
    if (error.code === 'ENOENT' && error.syscall?.startsWith('spawn '))
      console.error(
        'Bend was not found. Put Bend 2.0.40 on PATH (or set BEND to its executable) and retry fit.',
      );
    else console.error(error.message);
    process.exitCode = 1;
  });
