import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'bend-studio-browser-'));
const server = spawn(process.execPath, ['studio/server.mjs', '--port', '0'], {
  cwd: root,
  env: {...process.env, BEND_STUDIO_HOME: home},
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exit = once(server, 'close');
let browser,
  stderr = '';
server.stderr.on('data', (bytes) => (stderr += bytes));
try {
  const address = await Promise.race([
    new Promise((resolve) => {
      server.stdout.on('data', (bytes) => {
        const match = String(bytes).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    }),
    exit.then(() => {
      throw Error(stderr || 'Studio exited before startup');
    }),
  ]);
  browser = await chromium.launch({channel: 'chromium'});
  for (const width of [1366, 390]) {
    const discovery = await browser.newPage({viewport: {width, height: 900}});
    try {
      await discovery.goto(address);
      const plans = discovery.getByLabel('Training plan');
      const apex = plans.locator(
        'optgroup[label="Featured challenges"] option[value="apex-kart.json"]',
      );
      await apex.waitFor({state: 'attached'});
      assert.match(await apex.textContent(), /Apex Kart/);
      assert.equal(await plans.locator('option[value="dispatch-fit.json"]').count(), 0);
      await discovery.getByRole('heading', {name: 'Mountain Car'}).waitFor();
      await plans.selectOption('apex-kart.json');
      await discovery
        .getByText(/36 training trials.*8192 steps|36 training trials.*8,192 steps/)
        .waitFor();
      await discovery.getByRole('heading', {name: 'Mountain Car'}).waitFor();
      await discovery.locator('#world-list button').filter({hasText: 'Cliff Walk'}).click();
      assert.equal(await plans.inputValue(), '');
      await discovery.getByLabel('Learning algorithm').waitFor();

      let finish;
      const gate = new Promise((resolve) => {
        finish = resolve;
      });
      await discovery.route('**/api/manifest?file=apex-kart.json', async (route) => {
        await gate;
        await route.continue();
      });
      const pending = discovery.waitForResponse('**/api/manifest?file=apex-kart.json');
      await plans.selectOption('apex-kart.json');
      assert.equal(await discovery.locator('#train-btn').isDisabled(), true);
      let submitted = false;
      await discovery.route('**/api/runs', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        submitted = true;
        return route.abort();
      });
      await discovery.locator('#train').dispatchEvent('submit', {cancelable: true});
      await discovery.locator('#world-list button').filter({hasText: 'Mountain Car'}).click();
      finish();
      await pending;
      assert.equal(submitted, false, 'pending plan must not fall back to a preset submission');
      await discovery.getByLabel('Learning algorithm').waitFor();
      assert.equal(await plans.inputValue(), '');
      assert.equal(await discovery.locator('#manifest-info').isHidden(), true);
      assert.match(await discovery.locator('#train-btn').innerText(), /Train agent/);
      assert.ok(await discovery.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally {
      await discovery.close();
    }
  }
  const page = await browser.newPage({
    viewport: {width: 390, height: 844},
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  async function fits() {
    const {view, content} = await page.evaluate(() => ({
      view: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.equal(view, 390);
    assert.ok(content <= view, 'document overflows the viewport: ' + content);
  }
  await page.goto(address);
  const picker = page.getByLabel('Training plan');
  await picker.locator('option[value="toy-text.json"]').waitFor({state: 'attached'});
  await fits();
  await picker.selectOption('cliff-sarsa.json');
  await page.getByText(/sarsa: Finishing.*q-learning: Hooks/).waitFor();
  await picker.selectOption('');
  await page.getByLabel('Learning algorithm').waitFor();
  await picker.selectOption('toy-text.json');
  await page.getByText(/random: Hooks.*q: Hooks/).waitFor();
  await fits();
  await page.getByRole('button', {name: 'Train plan'}).click();
  await page.getByRole('button', {name: 'Experiments', exact: true}).click();
  await page.getByRole('button', {name: 'Open replay'}).waitFor();
  await fits();
  await page.getByRole('button', {name: 'Open replay'}).click();
  await page.getByRole('dialog').waitFor();
  await fits();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state: 'hidden'});
  await page.getByRole('button', {name: 'Open replay'}).click();
  await page.getByLabel('Training checkpoint').selectOption('0');
  const response = page.waitForResponse((r) => r.url().includes('/replay?') && r.ok());
  await page.locator('#load-replay').click();
  assert.deepEqual((await (await response).json()).gridLayout.rows, [
    'S...',
    '.P.P',
    '...P',
    'P..G',
  ]);
  await page.getByRole('dialog').waitFor({state: 'hidden'});
  await page.waitForFunction(() => document.querySelector('#simulator').hidden === false);
  // Confirm the pit, goal and agent pixels are present in the rendered image,
  // not merely in the network metadata.
  const count = await page.locator('#scene').evaluate((canvas) => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < bytes.length; i += 4)
      colors.add((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]);
    return [0x813a53, 0x2a8c67, 0x9ef8d3].filter((x) => colors.has(x)).length;
  });
  assert.equal(count, 3);
  await page.getByRole('button', {name: 'Next step'}).click();
  await fits();
  await picker.selectOption('acrobot.json');
  await page.getByText(/coarse-linear-q: Hooks/).waitFor();
  await page.getByRole('button', {name: 'Train plan'}).click();
  await page.getByRole('button', {name: 'Experiments', exact: true}).click();
  const robot = page.getByRole('article').filter({hasText: 'acrobot.json'});
  await robot.getByRole('button', {name: 'Open replay'}).click();
  await page.getByLabel('Training checkpoint').selectOption('0');
  const robotResponse = page.waitForResponse((r) => r.url().includes('/replay?') && r.ok());
  await page.locator('#load-replay').click();
  const robotTrace = await (await robotResponse).json();
  assert.equal(robotTrace.frames[0].observation.$, 'Acrobot');
  await page.getByRole('dialog').waitFor({state: 'hidden'});
  await page.getByRole('heading', {name: 'Acrobot'}).waitFor();
  const robotPixels = await page.locator('#scene').evaluate((canvas) => {
    const pixel = canvas.getContext('2d').getImageData(512, 226, 1, 1).data;
    return Array.from(pixel.slice(0, 3));
  });
  assert.deepEqual(robotPixels, [0xff, 0x89, 0x6c], 'the rendered pivot should be coral');
  await page.getByRole('button', {name: 'Next step'}).click();
  await fits();
  assert.deepEqual(errors, []);
  console.log(
    'Studio browser smoke passed: plan selection, replay, grid and Acrobot pixels, and 390 px layout.',
  );
} finally {
  await browser?.close();
  server.kill();
  await exit;
  await rm(home, {recursive: true, force: true});
}
