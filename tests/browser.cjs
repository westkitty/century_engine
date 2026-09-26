const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const url = process.env.URL || 'http://localhost:8000';
  await page.goto(url);
  await page.waitForFunction(() => window.century?.renderer?.state);
  await page.evaluate(() => {
    century.newCivilization('renderer-regression');
    century.closeSheet();
  });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const app = century,
      r = app.renderer;
    const original = JSON.stringify(app.world);
    for (const mode of ['districts', 'control', 'culture', 'sentiment', 'wealth', 'ecology'])
      r.render({ ...r.state, mode });
    const unchanged = original === JSON.stringify(app.world);
    const png = r.snapshotPNG(r.state).toDataURL();
    return {
      unchanged,
      png: png.startsWith('data:image/png'),
      units: r.units.length,
      renderer: r.constructor.name,
    };
  });
  assert(result.unchanged);
  assert(result.png);
  assert.equal(result.renderer, 'Renderer3D');
  console.log('snapshot/modes/purity', result);
  // Exercise actual simulation history, archaeology and rewinding, without altering sim sources.
  await page.evaluate(() => {
    const a = century;
    for (let i = 0; i < 100; i++) {
      if (a.world.pending) a.timelines.decide(a.branch, a.world.pending.options[0].id);
      a.step();
    }
    if (a.world.pending) a.timelines.decide(a.branch, a.world.pending.options[0].id);
    a.panel = null;
    a.closeSheet();
    a.arch = true;
  });
  await page.waitForTimeout(1500);
  console.log(
    'archaeology',
    await page.evaluate(() => ({
      year: century.viewYear,
      geometries: century.renderer.gl.info.memory.geometries,
      draws: century.renderer.gl.info.render.calls,
    })),
  );

  await page.evaluate(() => {
    century.viewYear = 1;
    century.arch = false;
    century.updateClock();
  });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const target = await page.evaluate(() => {
    const r = century.renderer;
    for (const s of r.units) {
      const p = r.visiblePoint(s.position);
      if (!p) continue;
      const x = ((p.x + 1) * r.W) / 2,
        y = ((1 - p.y) * r.H) / 2;
      if (y < 150 || y > 650) continue;
      const hit = r.hitTest(x, y, 1);
      if (hit?.kind === 'unit') return { x, y };
    }
  });
  assert(target);
  await page.mouse.click(target.x, target.y);
  assert.equal(await page.evaluate(() => century.panel.kind), 'unit');
  console.log('phone unit selection passed');
  await page.evaluate(() => century.closeSheet());
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => window.century?.renderer?.state);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.century?.renderer?.state);
  assert.equal(await page.evaluate(() => century.renderer.constructor.name), 'Renderer3D');
  console.log('offline reload passed');
  await context.setOffline(false);
  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.startsWith('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await fallback.goto(url);
  await fallback.waitForFunction(() => window.century?.branch);
  assert.equal(await fallback.evaluate(() => century.renderer.constructor.name), 'Renderer');
  console.log('2D fallback passed');
  assert.deepEqual(errors, []);
  console.log('console errors', errors);
  await browser.close();
})();
