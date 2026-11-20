// Use with a trusted, verified run made from experiments/apex-kart.json.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

if (process.argv.length !== 3) throw Error('usage: node tools/studio-smoke/kart.mjs TRUSTED_RUN');
const root = fileURLToPath(new URL('../../', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'bend-kart-browser-'));
const screenshotDir = process.env.KART_SMOKE_SCREENSHOTS;
const server = spawn(
  process.execPath,
  ['studio/server.mjs', '--port', '0', '--run', path.resolve(process.argv[2])],
  {cwd: root, env: {...process.env, BEND_STUDIO_HOME: home}, stdio: ['ignore', 'pipe', 'pipe']},
);
const exit = once(server, 'close');
let browser,
  stderr = '';
server.stderr.on('data', (b) => {
  stderr += b;
});
try {
  const address = await Promise.race([
    new Promise((resolve) =>
      server.stdout.on('data', (b) => {
        const match = String(b).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      }),
    ),
    exit.then(() => {
      throw Error(stderr || 'Studio stopped before startup');
    }),
  ]);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  browser = await chromium.launch(executablePath ? {executablePath} : {channel: 'chromium'});
  if (screenshotDir) await mkdir(screenshotDir, {recursive: true});
  const errors = [];
  async function setup(viewport, touch = false) {
    const page = await browser.newPage({
      viewport,
      isMobile: touch,
      hasTouch: touch,
      acceptDownloads: true,
    });
    page.setDefaultTimeout(14000);
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(address);
    await page.getByRole('heading', {name: 'Mountain Car', exact: true}).waitFor();
    return page;
  }
  async function choose(page, game, arm = 'dyna-5', episode = 1) {
    await page.getByRole('button', {name: 'Experiments', exact: true}).click();
    const run = page.getByRole('article').filter({has: page.getByText('apex-kart', {exact: true})});
    await run.getByRole('button', {name: 'Open replay'}).click();
    await page.getByLabel('Environment', {exact: true}).selectOption(game);
    await page.getByLabel('Agent', {exact: true}).selectOption(arm);
    await page.getByLabel('Training checkpoint').selectOption('8192');
    await page.getByLabel('Evaluation split').selectOption('test');
    await page.getByLabel('Episode', {exact: true}).fill(String(episode));
  }
  async function load(page, title) {
    const response = page.waitForResponse((r) => r.url().includes('/replay?') && r.ok());
    await page.getByRole('button', {name: 'Open in simulator'}).click();
    const body = await (await response).json();
    await page.getByRole('dialog').waitFor({state: 'hidden'});
    await page.getByRole('heading', {name: title, exact: true}).waitFor();
    assert.equal(body.gridLayout.renderer, 'apex-kart');
    return body;
  }
  async function screenshot(page, file) {
    if (screenshotDir)
      await page.locator('.viewer').screenshot({path: path.join(screenshotDir, file)});
  }
  const p = await setup({width: 1200, height: 980});
  const wheel = p.getByRole('slider', {name: 'Replay position'});
  const at = async (step) => assert.equal(await wheel.inputValue(), String(step));
  const play = p.locator('#play'),
    next = p.getByRole('button', {name: 'Next step'}),
    back = p.getByRole('button', {name: 'Previous step'});
  const picker = p.getByRole('dialog');
  const isRidge = (url) =>
    url.pathname.endsWith('/replay') && url.searchParams.get('game') === 'kart-ridge';
  let arrive, release, done;
  const ready = new Promise((r) => {
      arrive = r;
    }),
    gate = new Promise((r) => {
      release = r;
    }),
    completed = new Promise((r) => {
      done = r;
    });
  const defer = async (route) => {
    try {
      const response = await route.fetch();
      arrive();
      await gate;
      await route.fulfill({response});
    } catch (err) {
      if (!route.request().failure() && !String(err).includes('closed')) throw err;
    } finally {
      done();
    }
  };
  // Interrupted request: hold the older response, close its dialog, then load
  // another track. Releasing stale network output must not steal the view.
  await p.route(isRidge, defer, {times: 1});
  await choose(p, 'kart-ridge');
  await p.getByRole('button', {name: 'Open in simulator'}).click();
  await ready;
  await picker.getByText('Loading replay…').waitFor();
  await p.keyboard.press('Escape');
  await picker.waitFor({state: 'hidden'});
  await choose(p, 'kart-sprint');
  const sprint = await load(p, 'Quarry Sprint');
  release();
  await completed;
  assert.equal(await p.locator('#game-name').textContent(), 'Quarry Sprint');
  assert.equal(sprint.frames.length, 4);
  await at(0);
  await p.keyboard.press('ArrowRight');
  await at(1);
  await next.focus();
  await p.keyboard.press('End');
  await at(sprint.frames.length);
  assert.equal(await next.getAttribute('aria-disabled'), 'true');
  assert.equal(await next.evaluate((el) => document.activeElement === el), true);
  assert.equal((await play.textContent()).trim(), 'Replay');
  await p.keyboard.press('ArrowLeft');
  await at(sprint.frames.length - 1);
  assert.equal((await play.textContent()).trim(), 'Play');
  await p.keyboard.press('Home');
  await at(0);
  await wheel.focus();
  await p.keyboard.press('ArrowRight');
  await at(1);
  assert.match(await wheel.getAttribute('aria-valuetext'), /^Step 1 of 4.*speed/i);
  await p.keyboard.press('Home');
  await at(0);
  await p.locator('#speed').focus();
  await p.keyboard.press('ArrowDown');
  await at(0); // changing speed uses the browser's select behavior, not stepping
  await p.locator('#speed').selectOption('1');
  await p.locator('#game-name').focus();
  await p.keyboard.press('Space');
  await p.waitForFunction(() => Number(document.querySelector('#scrub').value) > 0);
  await p.keyboard.press('Space');
  const stopped = await wheel.inputValue();
  assert.equal((await play.textContent()).trim(), 'Play');
  await p.waitForTimeout(620);
  await at(stopped);
  await p.keyboard.press('End');
  assert.match(await p.locator('#kart-next').textContent(), /finish line crossed/i);
  assert.equal(await p.locator('#kart-speed').textContent(), '—');
  await play.click();
  await at(0);
  await play.click();
  await at(0);
  await p.goBack();
  await p.getByRole('heading', {name: 'Training runs', exact: true}).waitFor();
  await p.goForward();
  await p.getByRole('heading', {name: 'Quarry Sprint', exact: true}).waitFor();
  await at(0);

  // Real failed corner: show the penalty only on that action, not stale on rewind.
  await choose(p, 'kart-ridge', 'random', 2);
  const wild = await load(p, 'Juniper Ridge');
  const gravel = wild.frames.findIndex((f) => f.accepted && f.reward < 0) + 1;
  assert.ok(gravel > 0);
  for (let step = 1; step <= gravel; step++) await next.click();
  assert.match(await p.locator('#kart-event').textContent(), /4-point penalty/);
  await back.click();
  assert.equal(await p.locator('#kart-event').isVisible(), false);

  await choose(p, 'kart-ridge');
  const ridge = await load(p, 'Juniper Ridge');
  assert.equal(await p.locator('#game-name').evaluate((el) => document.activeElement === el), true);
  await at(0);
  for (let i = 0; i < 3; i++) await next.click();
  await at(3);
  assert.match(await p.locator('#kart-next').textContent(), /hairpin/i);
  await screenshot(p, 'kart-desktop.png');
  await p.locator('#record').evaluate((el) => {
    el.click();
    el.click();
  });
  await p.getByText('Recording cancelled', {exact: true}).waitFor();
  await p.getByRole('button', {name: 'Record GIF', exact: true}).click();
  await p.getByText('GIF saved in Recordings.', {exact: true}).waitFor();
  await p.getByRole('button', {name: 'Recordings', exact: true}).click();
  await p.locator('#clip-list').getByText('Juniper Ridge', {exact: true}).waitFor();
  const image = p.locator('#clip-list img');
  await image.waitFor();
  assert.equal(await image.count(), 1); // cancelled recording did not leave a clip
  await p.waitForFunction(() => document.querySelector('#clip-list img').naturalWidth === 512);

  const m = await setup({width: 390, height: 844}, true);
  await choose(m, 'kart-ridge');
  await load(m, 'Juniper Ridge');
  const mnext = m.getByRole('button', {name: 'Next step'});
  assert.ok((await mnext.boundingBox()).width >= 44 && (await mnext.boundingBox()).height >= 44);
  for (let i = 0; i < 3; i++) await mnext.tap();
  assert.equal(await m.locator('#counter').textContent(), 'Step 3 of ' + ridge.frames.length);
  for (const width of [390, 320]) {
    await m.setViewportSize({width, height: 844});
    const fit = await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(fit, true, 'no overflow at ' + width + 'px');
    await screenshot(m, 'kart-mobile-' + width + '.png');
  }
  // Changing away removes the kart-only controls/dashboard instead of leaking
  // them into another renderer's viewer.
  await m
    .getByRole('button', {name: /Mountain Car/})
    .first()
    .tap();
  await m.getByRole('heading', {name: 'Mountain Car', exact: true}).waitFor();
  assert.equal(await m.locator('#kart-readout').isVisible(), false);
  assert.equal(await m.locator('#scrub').getAttribute('aria-valuetext'), null);
  assert.deepEqual(errors, []);
  console.log(
    'Apex Kart browser: actual two-course replay; interrupted and repeated loads; keyboard steps, jump, pause and history; gravel; cancelled and saved GIF; 390/320 px touch; generic fallback.',
  );
} finally {
  await browser?.close();
  server.kill();
  await exit;
  await rm(home, {recursive: true, force: true});
}
