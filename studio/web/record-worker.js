import { renderGif } from './exporter.js';
self.onmessage = async ({ data: { trace, speed } }) => {
  try {
    const blob = await renderGif(
      trace,
      speed,
      (p) => postMessage({ progress: p }),
      () => false,
      new OffscreenCanvas(512, 220)
    );
    postMessage({ blob });
  } catch (e) {
    postMessage({ error: e.message });
  }
};
