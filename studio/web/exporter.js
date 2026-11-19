import {Gif} from './gif.js';
import {draw, observation, boardStates, tickRate} from './scene.js';

// Validation seeds repeat across checkpoints by design. Include the checkpoint
// and a short sealed-study identity in both downloadable formats.
export function replayFilename(trace, ext) {
  const parts = ['bend', trace.game, trace.arm, 'cp' + trace.checkpoint, trace.seed];
  if (trace.experiment) parts.push(String(trace.experiment).slice(0, 12));
  return parts.map((part) => String(part).replace(/[^\w-]/g, '-')).join('-') + '.' + ext;
}

// GIF delays use hundredths of a second. Browsers clamp delays below 20 ms.
// Sample fast replays at that limit while retaining their final observation.
export function timeline(steps, fps) {
  const ticksPerStep = 100 / fps;
  const frames = [];
  let start = 0;
  let elapsed = 0;
  for (let step = 1; step <= steps; step++) {
    const target = Math.round(step * ticksPerStep);
    const delay = target - elapsed;
    if (delay >= 2 || step === steps) {
      frames.push({step: start, delay: Math.max(2, delay)});
      start = step;
      elapsed = target;
    }
  }
  frames.push({step: steps, delay: 80});
  return frames;
}
export async function renderGif(trace, speed, onProgress, cancel, canvas) {
  const boards = ['tic-tac-toe', 'raw-board'].includes(trace.game) ? boardStates(trace) : [];
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const frames = timeline(trace.frames.length, tickRate(trace.game) * speed);
  let encoder;
  for (const [i, {step, delay}] of frames.entries()) {
    if (cancel()) throw Error('Recording cancelled');
    draw(canvas, trace.game, observation(trace, step), boards[step], trace.gridLayout);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    encoder ??= new Gif(canvas.width, canvas.height, pixels);
    encoder.frame(pixels, delay);
    if (i % 8 === 0 || i === frames.length - 1) {
      onProgress(Math.round(((i + 1) / frames.length) * 100));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return encoder.finish();
}
