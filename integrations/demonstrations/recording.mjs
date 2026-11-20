// Only public transitions enter a recording. Human inputs have no known behavior propensity.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {numberPreservingJson} from '../../core/finite_world.mjs';

import {freezeController, portablePolicy} from './policy.mjs';

export const modes = ['interactive-terminal', 'scripted-input'];
export const digest = (data) => createHash('sha256').update(data).digest('hex');
export const encode = (x) => numberPreservingJson(x, 2) + '\n';
const checksum = (value) => digest(numberPreservingJson(value));

export function recorder(world, seed, limit, inputMode, controller = null) {
  if (!modes.includes(inputMode)) throw Error('invalid input mode');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512)
    throw Error('demonstration horizon must be 1–512');
  const frozen = controller && freezeController(world, controller);
  const choose = frozen && portablePolicy(world, frozen);
  if (
    frozen &&
    (frozen.limit !== limit || frozen.training.demonstrations.some((d) => d.seed === seed))
  )
    throw Error('use the same horizon and a fresh collection seed for learner-state labels');
  const annotations = [];
  const session = world.start(seed, limit);
  const {initial} = session;
  const bounded = (legal) => {
    if (legal.length > 64) throw Error('demonstrations support up to 64 legal actions per view');
  };
  bounded(initial.legal);
  let view = initial;
  let done = initial.terminal;
  let score = 0;
  const frames = [];
  return {
    get view() {
      return view;
    },
    get proposed() {
      return choose && !done ? choose(view) : null;
    },
    get done() {
      return done;
    },
    get steps() {
      return frames.length;
    },
    get score() {
      return score;
    },
    actions() {
      return frames.map((f) => f.action);
    },
    labels() {
      return annotations.map((a) => a.teacherLabel);
    },
    step(input) {
      if (done || (!(choose && input === null) && !view.legal.includes(input)))
        throw Error('choose a listed legal action');
      const action = choose ? choose(view) : input;
      const result = session.step(action);
      if (choose)
        annotations.push({
          proposedAction: action,
          appliedAction: result.frame.action,
          teacherLabel: input,
        });
      const frame = result.frame;
      bounded(frame.nextLegal);
      frames.push(frame);
      score = Math.fround(score + frame.reward);
      if (!Number.isFinite(score)) throw Error('non-finite episode return');
      view = {observation: frame.nextObservation, legal: frame.nextLegal};
      done = result.done;
      return frame;
    },
    finish() {
      if (!done) throw Error('partial demonstration: finish the episode before saving');
      const episode = {
        schema: 'bend-demonstration-v1',
        worldSha256: world.sha256,
        inputMode,
        seed,
        limit,
        initial,
        frames,
        reason: view.legal.length ? 'Limit' : 'Terminal',
        score,
      };
      if (choose)
        Object.assign(episode, {
          schema: 'bend-learner-labels-v1',
          controller: frozen,
          controllerSha256: checksum(frozen),
          annotations,
        });
      return {sha256: checksum(episode), episode};
    },
  };
}

export function verify(world, record) {
  const ep = record?.episode;
  const labeling = ep?.schema === 'bend-learner-labels-v1';
  if (
    !ep ||
    (!labeling && ep.schema !== 'bend-demonstration-v1') ||
    !Array.isArray(ep.frames) ||
    ep.worldSha256 !== world.sha256
  )
    throw Error('wrong demonstration format or world');
  if (record.sha256 !== checksum(ep)) throw Error('demonstration checksum mismatch');
  if (
    labeling &&
    (!ep.controller || !Array.isArray(ep.annotations) || ep.annotations.length !== ep.frames.length)
  )
    throw Error('invalid label annotations');
  const game = recorder(world, ep.seed, ep.limit, ep.inputMode, labeling ? ep.controller : null);
  if (!isDeepStrictEqual(ep.initial, game.view)) throw Error('replay mismatch at reset');
  for (const [i, saved] of ep.frames.entries()) {
    if (
      game.done ||
      !saved ||
      !game.view.legal.includes(saved.action) ||
      !isDeepStrictEqual(
        game.step(labeling ? ep.annotations[i]?.teacherLabel : saved.action),
        saved,
      )
    )
      throw Error('replay mismatch at step ' + (i + 1));
  }
  if (!isDeepStrictEqual(game.finish(), record))
    throw Error('replay mismatch in episode summary or fields');
  return ep;
}
