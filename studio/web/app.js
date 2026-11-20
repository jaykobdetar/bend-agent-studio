import {kartTelemetry} from './kart-scene.js';
import {comparisonUI} from './compare.js';
import {
  actionName,
  boardStates,
  channels,
  cumulativeReturns,
  courierCaption,
  draw,
  gameName,
  observation,
  replayChoice,
  replaySelection,
  tickRate,
} from './scene.js';
import {renderGif, replayFilename} from './exporter.js';
import {deleteClip, listClips, saveClip} from './vault.js';

const $ = (id) => document.getElementById(id);
const state = {
  worlds: [],
  runs: [],
  selected: null,
  trace: null,
  frame: 0,
  generation: 0,
  page: '',
  playing: false,
};
const pages = {
  simulator: [
    'Simulation workspace',
    'Train an agent and explore its decisions, one step at a time.',
  ],
  experiments: [
    'Experiments',
    'Open a saved run to compare checkpoints and replay held-out episodes.',
  ],
  recordings: ['Recordings', 'Preview and download gameplay saved in this browser.'],
};

function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, click, className) {
  const el = element('button', text, className);
  el.type = 'button';
  el.addEventListener('click', click);
  return el;
}
function choices(select, entries) {
  select.replaceChildren(...entries.map(([value, name]) => new Option(name, value)));
}
// Keep visible names friendly while retaining the exact plan path as the value.
const featuredPlans = new Map([
  ['apex-kart.json', 'Apex Kart · two time trials'],
  ['locksmith-courier.json', 'Locksmith Courier · route planning'],
  ['switchboard.json', 'Switchboard · memory'],
  ['storm-reserve.json', 'Storm Reserve · resource planning'],
]);
function showTrainingPlans(files) {
  const available = new Set(files);
  const groups = [
    ['Featured challenges', [...featuredPlans].filter(([file]) => available.has(file))],
    [
      'Other training plans',
      files.filter((file) => !featuredPlans.has(file)).map((file) => [file, file]),
    ],
  ];
  $('manifest').replaceChildren(
    new Option('Use the selected demo environment', ''),
    ...groups
      .filter(([, entries]) => entries.length)
      .map(([label, entries]) => {
        const group = element('optgroup');
        group.label = label;
        group.append(...entries.map(([file, name]) => new Option(name, file)));
        return group;
      }),
  );
}
async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw Error(body.error || response.statusText);
  return body;
}
let toastTimer;
function notify(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 5000);
}
const number = (value) =>
  Number.isFinite(value)
    ? Number(value.toFixed(3)).toLocaleString('en-US', {maximumFractionDigits: 3})
    : '—';
const algoName = (game, id) =>
  state.worlds.find((w) => w.id === game)?.algorithms.find((a) => a.id === id)?.name ?? id;
const friendlyPhase = (phase) => (phase === 'test' ? 'Test' : 'Validation');
function reason(t) {
  const why = t.reason?.$ ?? t.reason;
  if (why === 'Limit') return 'Step limit';
  if (why === 'Illegal') return 'Illegal action';
  if (why === 'Terminal' && t.gridLayout?.renderer === 'apex-kart') return 'Finish line crossed';
  if (why === 'Terminal' && ['cliff', 'mountain_car', 'acrobot'].includes(t.game))
    return 'Goal reached';
  if (why === 'Terminal' && ['tic-tac-toe', 'raw-board'].includes(t.game))
    return t.score === 0 ? 'Draw' : t.score > 0 ? 'X won' : 'O won';
  return why || '—';
}

function selectPreset(world) {
  state.selected = world?.id;
  document.querySelectorAll('.world').forEach((el) => {
    const selected = el.dataset.world === state.selected;
    el.classList.toggle('active', selected);
    el.setAttribute('aria-pressed', selected);
  });
  choices(
    $('agent'),
    (world?.algorithms ?? []).map((a) => [a.id, a.name]),
  );
  $('budget').value = world?.episodes ?? '';
  syncForm();
}
async function chooseWorld(world) {
  pause();
  activeReplay?.abort();
  const ticket = ++state.generation;
  selectPreset(world);
  try {
    const trace = await api('/demos/' + encodeURIComponent(world.id) + '.json');
    if (ticket === state.generation) showTrace(trace, 'Example replay');
  } catch (err) {
    if (ticket === state.generation) notify(err.message);
  }
}
function showWorlds() {
  $('world-list').replaceChildren(
    ...state.worlds.map((world) => {
      const el = button(
        '',
        () => {
          const picker = $('manifest');
          if (picker.value) {
            picker.value = '';
            picker.dispatchEvent(new Event('change'));
          }
          chooseWorld(world);
        },
        'world',
      );
      el.dataset.world = world.id;
      el.title = world.description;
      const thumb = element('canvas');
      thumb.width = 148;
      thumb.height = 72;
      thumb.setAttribute('aria-hidden', 'true');
      draw(thumb, world.id);
      const labels = element('span');
      labels.append(element('strong', world.name), element('small', world.category));
      el.append(thumb, labels);
      return el;
    }),
  );
}
function showTrace(trace, source) {
  pause();
  state.trace = trace;
  state.frame = 0;
  state.boards = ['tic-tac-toe', 'raw-board'].includes(trace.game) ? boardStates(trace) : [];
  const totals = cumulativeReturns(trace.frames);
  state.totals = totals;
  const courier = trace.gridLayout?.renderer === 'courier';
  const kart = trace.gridLayout?.renderer === 'apex-kart';
  state.kart = kart;
  $('scene').parentElement.classList.toggle('kart-hud', kart);
  $('scene').closest('.viewer').classList.toggle('kart-replay', kart);
  $('kart-replay-keys').hidden = !kart;
  $('replay-announce').textContent = '';
  for (const [id, key] of [
    ['play', 'Space'],
    ['back', 'ArrowLeft'],
    ['next', 'ArrowRight'],
  ]) {
    if (kart) $(id).setAttribute('aria-keyshortcuts', key);
    else $(id).removeAttribute('aria-keyshortcuts');
  }
  $('game-name').textContent = kart
    ? trace.gridLayout.title
    : courier
      ? 'Locksmith Courier'
      : gameName(trace.game);
  $('source').textContent = source;
  $('world-description').textContent = kart
    ? 'Apex Kart time trial. Carry speed on straights and set up early for each corner.'
    : courier
      ? 'Fetch each door’s key or spend a bypass charge.'
      : (state.worlds.find((w) => w.id === trace.game)?.description ??
        'Inspect the public observations from this environment.');
  $('stage-label').textContent =
    friendlyPhase(trace.phase).toUpperCase() +
    ' EPISODE ' +
    String(trace.index + 1).padStart(2, '0');
  $('scrub').max = trace.frames.length;
  $('scene').setAttribute('aria-label', gameName(trace.game) + ' agent replay');
  $('details').replaceChildren();
  for (const [key, value] of [
    ['Agent', algoName(trace.game, trace.arm)],
    ['Checkpoint', number(trace.checkpoint) + ' ' + trace.budgetUnit],
    ['Replay seed', String(trace.seed)],
    ['Outcome', reason(trace)],
  ])
    $('details').append(element('dt', key), element('dd', value));
  state.metrics = ['Return so far', 'Last action', 'Step reward'].map((name) => {
    const el = element('div', undefined, 'metric'),
      value = element('strong');
    el.append(element('span', name), value);
    return {el, value};
  });
  $('metrics').replaceChildren(...state.metrics.map((m) => m.el));
  state.signals = channels(trace.game).map(([name, key], index) => {
    const el = element('div', undefined, 'signal'),
      head = element('header'),
      value = element('span');
    const canvas = element('canvas');
    canvas.width = 480;
    canvas.height = 56;
    canvas.setAttribute('aria-hidden', 'true');
    head.append(element('span', name), value);
    el.append(head, canvas);
    const data = totals.map((sum, i) =>
      key === 'total'
        ? sum
        : key === 'reward'
          ? (trace.frames[i - 1]?.reward ?? 0)
          : (observation(trace, i)?.[key] ?? 0),
    );
    const bounds = data.reduce(
      ([lo, hi], n) => [Math.min(lo, n), Math.max(hi, n)],
      [Infinity, -Infinity],
    );
    return {el, value, canvas, data, bounds, color: index ? '#93d8bd' : '#ffa386'};
  });
  $('signals').replaceChildren(...state.signals.map((s) => s.el));
  render();
}
function graph(signal, index) {
  const {
    canvas,
    data,
    bounds: [lo, hi],
    color,
  } = signal;
  const c = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height;
  const x = (i) => 2 + (i / Math.max(1, data.length - 1)) * (w - 4);
  const y = (i) => (hi === lo ? h / 2 : 4 + ((hi - data[i]) / (hi - lo)) * (h - 8));
  c.clearRect(0, 0, w, h);
  c.beginPath();
  data.forEach((_, i) => (i ? c.lineTo(x(i), y(i)) : c.moveTo(x(i), y(i))));
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.stroke();
  c.beginPath();
  c.moveTo(x(index), 0);
  c.lineTo(x(index), h);
  c.strokeStyle = '#8e889a';
  c.stroke();
  c.beginPath();
  c.arc(x(index), y(index), 3, 0, 2 * Math.PI);
  c.fillStyle = color;
  c.fill();
  signal.value.textContent = number(data[index]);
}
function render(announce = false) {
  const t = state.trace;
  if (!t) return;
  const i = state.frame,
    n = t.frames.length,
    f = t.frames[i - 1];
  const obs = observation(t, i);
  draw($('scene'), t.game, obs, state.boards[i], t.gridLayout, {kartDashboard: false});
  const telemetry = kartTelemetry(t.gridLayout, obs);
  const caption = telemetry?.caption ?? courierCaption(t.gridLayout, obs);
  if (['apex-kart', 'courier'].includes(t.gridLayout?.renderer))
    $('scene').setAttribute('aria-label', caption ?? gameName(t.game) + ' agent replay');
  $('scrub').value = i;
  $('scrub').style.setProperty('--progress', (n ? (i / n) * 100 : 0) + '%');
  const action = actionName(t.game, f?.action, t.gridLayout);
  $('kart-readout').hidden = !telemetry;
  if (telemetry) {
    const {distance, length, lane, speed, next} = telemetry;
    $('kart-progress').textContent = distance + ' / ' + length + ' cells';
    $('kart-speed').textContent = speed === null ? '—' : speed + ' / 3';
    $('kart-lane').textContent = lane ?? '—';
    $('kart-next').textContent = next;
    const gravel = f?.accepted && f.reward < 0;
    $('kart-event').hidden = !gravel;
    $('kart-event').textContent = gravel ? 'Gravel on this step · 4-point penalty' : '';
    const step = 'Step ' + i + ' of ' + n;
    const narration =
      step +
      '. ' +
      (f ? 'Action: ' + action + '. ' : '') +
      caption +
      (gravel ? ' Gravel penalty.' : '');
    $('scrub').setAttribute('aria-valuetext', narration);
    if (announce && document.activeElement !== $('scrub'))
      $('replay-announce').textContent = narration;
  } else $('scrub').removeAttribute('aria-valuetext');
  $('counter').textContent = state.kart ? 'Step ' + i + ' of ' + n : i + ' / ' + n;
  $('stage-step').textContent = 'STEP ' + String(i).padStart(3, '0');
  for (const [id, atEdge] of [
    ['back', i === 0],
    ['next', i === n],
  ]) {
    // Keep keyboard focus on a step button at the boundary of a kart replay.
    $(id).disabled = !state.kart && atEdge;
    if (state.kart) $(id).setAttribute('aria-disabled', atEdge);
    else $(id).removeAttribute('aria-disabled');
  }
  $('play').disabled = !n;
  state.metrics[0].value.textContent = number(state.totals[i]);
  state.metrics[1].value.textContent = action;
  state.metrics[2].value.textContent = number(f?.reward);
  for (const s of state.signals) graph(s, i);
  playLabel();
}
function pause() {
  clearInterval(state.timer);
  state.playing = false;
  playLabel();
}
function playLabel() {
  const ending =
    state.kart && state.trace?.frames.length > 0 && state.frame === state.trace.frames.length;
  $('play-text').textContent = state.playing ? 'Pause' : ending ? 'Replay' : 'Play';
  $('play').firstElementChild.className = state.playing ? 'pause-shape' : 'play-shape';
}
function play() {
  if (!state.trace?.frames.length) return;
  if (state.playing) return pause();
  if (state.frame === state.trace.frames.length) {
    state.frame = 0;
    render();
  }
  state.playing = true;
  $('replay-announce').textContent = '';
  playLabel();
  state.timer = setInterval(
    () => {
      state.frame++;
      const atEnd = state.frame === state.trace.frames.length;
      render(atEnd);
      if (atEnd) pause();
    },
    1000 / (tickRate(state.trace.game) * Number($('speed').value)),
  );
}
function seek(index) {
  if (!state.trace) return;
  pause();
  state.frame = Math.max(0, Math.min(index, state.trace.frames.length));
  render(true);
}
$('play').onclick = play;
$('back').onclick = () => {
  if (state.frame > 0) seek(state.frame - 1);
};
$('next').onclick = () => {
  if (state.frame < state.trace?.frames.length) seek(state.frame + 1);
};
$('scrub').oninput = (e) => seek(Number(e.target.value));
$('speed').onchange = () => {
  if (state.playing) {
    pause();
    play();
  }
};
document.addEventListener('keydown', (e) => {
  if (
    e.defaultPrevented ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    e.shiftKey ||
    state.page !== 'simulator' ||
    $('run-dialog').open
  )
    return;
  // Sliders, select boxes, and text inputs retain their native keyboard
  // behavior. For kart, the focused play/step buttons also accept steppers.
  const control = e.target.closest?.('input,select,button,a,textarea,[contenteditable]');
  const kartStepper = state.kart && ['play', 'back', 'next'].includes(control?.id);
  if (control && !kartStepper) return;
  if (e.key === ' ' && !control) {
    e.preventDefault();
    if (!e.repeat) play();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    seek(state.frame + (e.key === 'ArrowLeft' ? -1 : 1));
  } else if (state.kart && (e.key === 'Home' || e.key === 'End')) {
    e.preventDefault();
    seek(e.key === 'Home' ? 0 : state.trace.frames.length);
  }
});
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = element('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('export-json').onclick = () => {
  if (state.trace)
    download(
      new Blob([JSON.stringify(state.trace, null, 2)], {type: 'application/json'}),
      replayFilename(state.trace, 'json'),
    );
};
$('reroll').onclick = () => {
  $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000001;
};

function empty(title, hint) {
  const box = element('div', undefined, 'empty');
  box.append(element('strong', title), element('span', hint));
  return box;
}
const refreshCompare = comparisonUI($('comparison'), api);
function syncForm() {
  const busy = state.runs.some((r) => r.status === 'training' || r.status === 'queued');
  const usingManifest = Boolean($('manifest').value);
  $('preset-fields').hidden = usingManifest;
  $('preset-fields').disabled = usingManifest;
  $('train-btn').disabled =
    !(usingManifest ? state.manifestInfo : state.selected) || state.submitting;
  $('train-btn').lastElementChild.textContent = state.submitting
    ? 'Submitting…'
    : busy
      ? 'Queue training'
      : usingManifest
        ? 'Train plan'
        : 'Train agent';
  $('job-status').textContent =
    state.message ||
    (busy
      ? 'One run trains at a time. Queued jobs can be cancelled in Experiments.'
      : state.selected || state.manifestInfo
        ? 'New runs are saved in Experiments.'
        : 'Choose an environment or training plan to start a new run.');
}
let renderedRuns;
function showRuns() {
  const snapshot = JSON.stringify(state.runs);
  if (snapshot === renderedRuns) return;
  renderedRuns = snapshot;
  refreshCompare(state.runs);
  const list = $('run-list');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusedId = focused?.closest('article')?.dataset.runId;
  const items = state.runs.map((run) => {
    const row = element('article', undefined, 'run-row'),
      info = element('div');
    row.dataset.runId = run.id;
    info.append(element('strong', run.name));
    const description = run.attached
      ? ['Attached run', 'Checkpoint completeness not checked']
      : [
          run.status === 'ready'
            ? 'Ready'
            : run.status === 'queued'
              ? 'Queued · position ' + run.position
              : run.status,
          run.created ? new Date(run.created).toLocaleString() : 'Attached run',
        ];
    if (run.manifest) description.push(run.manifest);
    if (run.episodes) description.push(number(run.episodes) + ' episodes', 'seed ' + run.seed);
    info.append(element('p', description.join(' · '), 'meta'));
    if (run.annotations?.notes) info.append(element('p', run.annotations.notes, 'run-notes'));
    if (run.annotations?.tags?.length)
      info.append(element('p', 'Tags: ' + run.annotations.tags.join(', '), 'meta'));
    if (run.annotationWarning) info.append(element('p', run.annotationWarning, 'meta'));
    if (run.error) info.append(element('p', run.error, 'meta'));
    row.append(info);
    if (run.status === 'ready')
      row.append(button('Open replay', () => openDialog(run), 'secondary'));
    if (['training', 'queued'].includes(run.status))
      row.append(
        button(
          run.status === 'queued' ? 'Cancel queued job' : 'Cancel training',
          async (event) => {
            const cancel = event.currentTarget;
            cancel.disabled = true;
            try {
              await api('/api/runs/' + run.id + '/cancel', {method: 'POST'});
              await refreshRuns();
            } catch (err) {
              notify(err.message);
              cancel.disabled = false;
            }
          },
          'secondary',
        ),
      );
    return row;
  });
  list.replaceChildren(
    ...(items.length
      ? items
      : [
          empty(
            'No experiments yet',
            'Choose an environment and select Train agent to save your first run.',
          ),
        ]),
  );
  // Polling another job must not take the keyboard away from this run.
  const replacement =
    focusedId && items.find((row) => row.dataset.runId === focusedId)?.querySelector('button');
  if (replacement && replacement.textContent === focused.textContent)
    replacement.focus({preventScroll: true});
}
let refreshPending, watchTimer;
async function refreshRuns() {
  if (refreshPending) return refreshPending;
  refreshPending = (async () => {
    const runs = await api('/api/runs');
    state.runs = runs;
    showRuns();
    syncForm();
    const finished = runs.find(
      (r) => r.id === state.watch && !['queued', 'training'].includes(r.status),
    );
    if (finished) {
      state.watch = undefined;
      state.message =
        finished.status === 'ready'
          ? 'Training complete. Run saved in Experiments.'
          : finished.error;
      syncForm();
      if (
        finished.status === 'ready' &&
        !finished.manifest &&
        state.page === 'simulator' &&
        state.generation === state.watchGeneration
      )
        await loadRun(finished, {
          game: finished.world,
          arm: finished.algorithm,
          point: finished.checkpoints.at(-1),
          rep: 0,
          phase: 'test',
          episode: 0,
        });
    }
  })();
  try {
    await refreshPending;
  } finally {
    refreshPending = undefined;
    clearTimeout(watchTimer);
    if (state.watch || state.runs.some((r) => ['queued', 'training'].includes(r.status)))
      watchTimer = setTimeout(() => refreshRuns().catch((e) => notify(e.message)), 900);
  }
}
$('manifest').onchange = async () => {
  const seq = (state.manifestSequence ?? 0) + 1,
    file = $('manifest').value;
  state.manifestSequence = seq;
  state.manifestInfo = null;
  state.message = '';
  const info = $('manifest-info');
  info.hidden = !file;
  info.textContent = file ? 'Validating plan…' : '';
  syncForm();
  if (!file) return;
  try {
    const plan = await api('/api/manifest?file=' + encodeURIComponent(file));
    if (seq !== state.manifestSequence) return;
    state.manifestInfo = plan;
    const count = (n, label) => n + ' ' + label + (n === 1 ? '' : 's');
    const trials = plan.games.length * plan.hooks.length * plan.replicates;
    const budget = number(plan.checkpoints.at(-1)) + ' ' + plan.budgetUnit;
    info.replaceChildren(
      element('strong', count(trials, 'training trial') + ' · up to ' + budget + ' each'),
      element(
        'span',
        [
          count(plan.games.length, 'world'),
          count(plan.hooks.length, 'agent'),
          count(plan.replicates, 'replicate') + ' per world and agent',
        ].join(' · '),
      ),
      element(
        'span',
        file + ' · Hooks: ' + plan.hooks.map(({arm, hook}) => arm + ': ' + hook).join(', '),
      ),
    );
  } catch (err) {
    if (seq === state.manifestSequence) info.textContent = err.message;
  }
  syncForm();
};
$('train').onsubmit = async (e) => {
  e.preventDefault();
  const manifest = $('manifest').value;
  if (state.submitting || (manifest ? state.manifestInfo?.file !== manifest : !state.selected))
    return;
  const generation = state.generation;
  const body = manifest
    ? {manifest}
    : {
        world: state.selected,
        algorithm: $('agent').value,
        episodes: Number($('budget').value),
        seed: Number($('seed').value),
      };
  state.submitting = true;
  state.message = '';
  syncForm();
  try {
    const run = await api('/api/runs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    state.watch = run.id;
    state.watchGeneration = generation;
    await refreshRuns();
  } catch (err) {
    state.message = err.message;
  } finally {
    state.submitting = false;
    syncForm();
  }
};
let activeReplay;
async function loadRun(run, params) {
  activeReplay?.abort();
  const controller = new AbortController();
  activeReplay = controller;
  const generation = ++state.generation;
  try {
    const trace = await api('/api/runs/' + run.id + '/replay?' + new URLSearchParams(params), {
      signal: controller.signal,
    });
    if (controller.signal.aborted || generation !== state.generation) return false;
    const world = state.worlds.find((w) => w.id === trace.game);
    if (world?.id !== state.selected) selectPreset(world);
    showTrace(trace, 'Experiment replay');
    return true;
  } catch (err) {
    if (controller.signal.aborted) return false;
    throw err;
  } finally {
    if (activeReplay === controller) activeReplay = undefined;
  }
}
function openDialog(run) {
  activeReplay?.abort();
  const box = $('replay-options');
  box.className = 'option-grid';
  box.replaceChildren();
  function field(name, id, entries) {
    const group = element('div'),
      label = element('label', name),
      select = element('select');
    select.id = 'pick-' + id;
    label.htmlFor = select.id;
    if (entries) choices(select, entries);
    group.append(label, select);
    box.append(group);
    return select;
  }
  const game = field(
    'Environment',
    'game',
    run.games.map((g) => [g.id, gameName(g.id)]),
  );
  const arm = field('Agent', 'arm');
  const point = field(
    'Training checkpoint',
    'point',
    run.checkpoints.map((n) => [n, number(n)]),
  );
  const rep = field(
    'Replicate',
    'rep',
    Array.from({length: run.replicates}, (_, i) => [i, i + 1]),
  );
  const phase = field('Evaluation split', 'phase');
  const group = element('div'),
    label = element('label', 'Episode'),
    ep = element('input');
  ep.id = 'pick-episode';
  label.htmlFor = ep.id;
  ep.type = 'number';
  ep.min = 1;
  ep.required = true;
  group.append(label, ep);
  box.append(group);
  const note = element('p', '', 'dialog-note');
  box.append(note);
  const agents = () => {
    const selected = replayChoice(run.arms, arm.value);
    choices(
      arm,
      run.arms.map((a) => [a, algoName(game.value, a)]),
    );
    arm.value = selected;
  };
  const syncEvaluation = () => {
    const next = replaySelection(run, point.value, phase.value, ep.value);
    choices(
      phase,
      next.phases.map((p) => [p, friendlyPhase(p)]),
    );
    phase.value = next.phase;
    ep.max = next.max;
    ep.value = next.episode;
    $('load-replay').disabled = !next.phase;
    note.textContent = next.phase ? '' : 'This checkpoint has no evaluation episodes.';
  };
  game.onchange = agents;
  point.onchange = phase.onchange = syncEvaluation;
  point.value = run.checkpoints.at(-1);
  agents();
  syncEvaluation();
  $('load-replay').onclick = async () => {
    if (!ep.reportValidity()) return;
    $('load-replay').disabled = true;
    for (const field of [game, arm, point, rep, phase, ep]) field.disabled = true;
    note.textContent = 'Loading replay…';
    try {
      const loaded = await loadRun(run, {
        game: game.value,
        arm: arm.value,
        point: point.value,
        rep: rep.value,
        phase: phase.value,
        episode: Number(ep.value) - 1,
      });
      if (!loaded || !$('run-dialog').open) return;
      $('run-dialog').close();
      navigate('simulator');
      if (state.kart) {
        const heading = $('game-name');
        heading.closest('.viewer').scrollIntoView({block: 'start'});
        heading.focus({preventScroll: true});
      }
    } catch (err) {
      note.textContent = err.message;
    } finally {
      for (const field of [game, arm, point, rep, phase, ep]) field.disabled = false;
      if (note.isConnected) $('load-replay').disabled = !phase.value;
    }
  };
  $('run-dialog').showModal();
}
$('run-dialog').addEventListener('close', () => {
  if (!$('run-dialog').open) activeReplay?.abort();
});

let recording;
function recordLabel(text) {
  $('record').lastElementChild.textContent = text;
}
async function record() {
  if (recording) {
    recording.cancel();
    return;
  }
  if (!state.trace) return;
  const trace = state.trace,
    speed = Number($('speed').value);
  const current = {
    cancelled: false,
    cancel() {
      this.cancelled = true;
      this.stop?.();
    },
  };
  recording = current;
  const progress = (n) => recordLabel('Cancel · ' + n + '%');
  try {
    progress(0);
    let blob;
    if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
      const worker = new Worker(new URL('./record-worker.js', import.meta.url), {type: 'module'});
      try {
        blob = await new Promise((resolve, reject) => {
          current.stop = () => reject(Error('Recording cancelled'));
          worker.onmessage = ({data}) => {
            if (data.blob) resolve(data.blob);
            else if (data.error) reject(Error(data.error));
            else progress(data.progress);
          };
          worker.onerror = (e) => reject(Error(e.message || 'Recording failed'));
          worker.postMessage({trace, speed});
        });
      } finally {
        worker.terminate();
      }
    } else {
      const canvas = element('canvas');
      canvas.width = 512;
      canvas.height = 220;
      blob = await renderGif(trace, speed, progress, () => current.cancelled, canvas);
    }
    const file = replayFilename(trace, 'gif');
    try {
      await saveClip({
        id: crypto.randomUUID(),
        title:
          trace.gridLayout?.renderer === 'apex-kart'
            ? trace.gridLayout.title
            : gameName(trace.game),
        agent: algoName(trace.game, trace.arm),
        steps: trace.frames.length,
        speed,
        created: Date.now(),
        file,
        blob,
      });
      notify('GIF saved in Recordings.');
      if (state.page === 'recordings') await showClips();
    } catch {
      download(blob, file);
      notify('Browser storage is unavailable. Your GIF was downloaded.');
    }
  } catch (err) {
    notify(err.message);
  } finally {
    recording = undefined;
    recordLabel('Record GIF');
  }
}
$('record').onclick = record;
let clipUrls = [],
  clipGeneration = 0;
function releaseClips() {
  clipGeneration++;
  clipUrls.forEach((url) => URL.revokeObjectURL(url));
  clipUrls = [];
}
async function showClips() {
  releaseClips();
  const generation = clipGeneration;
  try {
    const clips = await listClips();
    if (generation !== clipGeneration) return;
    const box = $('clip-list');
    box.className = clips.length ? 'clip-grid' : '';
    if (!clips.length) {
      box.replaceChildren(
        empty(
          'No recordings yet',
          'Open a replay and select Record GIF to save the entire episode.',
        ),
      );
      return;
    }
    box.replaceChildren(
      ...clips
        .sort((a, b) => b.created - a.created)
        .map((clip) => {
          const item = element('article', undefined, 'clip'),
            img = element('img'),
            url = URL.createObjectURL(clip.blob);
          clipUrls.push(url);
          img.src = url;
          img.alt = clip.title + ' animated gameplay';
          const info = element(
            'p',
            clip.agent + ' · ' + clip.steps + ' steps · ' + clip.speed + '×',
            'meta',
          );
          const footer = element('footer'),
            link = element('a', 'Download GIF');
          link.href = url;
          link.download = clip.file;
          footer.append(
            link,
            button('Delete', async () => {
              if (!window.confirm('Delete this recording from this browser?')) return;
              try {
                await deleteClip(clip.id);
                await showClips();
              } catch (err) {
                notify(err.message);
              }
            }),
          );
          item.append(img, element('strong', clip.title), info, footer);
          return item;
        }),
    );
  } catch (err) {
    $('clip-list').replaceChildren(empty('Recordings unavailable', err.message));
  }
}
function navigate(name, fromAddress = false) {
  if (!Object.hasOwn(pages, name)) name = 'simulator';
  if (state.page !== name) {
    activeReplay?.abort();
    if ($('run-dialog').open) $('run-dialog').close();
  }
  if (location.hash !== '#' + name) {
    if (fromAddress) history.replaceState(null, '', '#' + name);
    else history.pushState(null, '', '#' + name);
  }
  pause();
  releaseClips();
  state.page = name;
  [$('title').textContent, $('subtitle').textContent] = pages[name];
  document.title = 'Bend Studio · ' + (name[0].toUpperCase() + name.slice(1));
  for (const id of Object.keys(pages)) $(id).hidden = id !== name;
  for (const el of document.querySelectorAll('[data-nav]')) {
    const selected = el.dataset.nav === name;
    el.classList.toggle('current', selected);
    if (selected) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  if (name === 'experiments') refreshRuns().catch((err) => notify(err.message));
  if (name === 'recordings') showClips();
}
for (const el of document.querySelectorAll('[data-nav],[data-go]'))
  el.onclick = () => navigate(el.dataset.nav ?? el.dataset.go);
window.onhashchange = () => navigate(location.hash.slice(1), true);
try {
  state.worlds = await api('/api/catalog');
  const manifests = await api('/api/manifests');
  showTrainingPlans(manifests);
  showWorlds();
  await chooseWorld(state.worlds[0]);
  navigate(location.hash.slice(1), true);
  await refreshRuns();
} catch (err) {
  $('job-status').textContent = err.message;
  notify(err.message);
}
