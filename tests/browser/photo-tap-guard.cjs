const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.VITRINE_URL || 'http://127.0.0.1:5182/vitrine/';
const out = path.resolve(process.env.QA_OUTPUT_DIR || '../design-review/photo-tap-guard');

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const results = [];
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('**/rest/v1/analytics_events*', r => r.fulfill({ status: 201, body: '[]' }));
    await context.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const media = page.locator('[data-card-carousel]').first();
    const slide = media.locator('[data-card-slide="0"]');
    const viewer = page.locator('.otbasu-photo-viewer');

    async function settle() {
      await slide.scrollIntoViewIfNeeded();
      await page.waitForTimeout(750);
    }

    async function assertClosed(label) {
      assert.equal(await viewer.count(), 0, label);
      assert.equal(await page.locator('#gallery-modal[aria-hidden="false"]').count(), 0, label);
    }

    async function closeViewer() {
      await viewer.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await viewer.waitFor({ state: 'detached' });
    }

    // Force a compatibility click after movement, even when Chrome would suppress it.
    // This covers short gestures and browser-specific delayed/ghost clicks.
    async function gesture({ moves = [], end = null, cancel = false, multi = false, pointerType = 'touch', click = true } = {}) {
      await slide.evaluate((el, data) => {
        const r = el.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, pointerId: 17, pointerType: data.pointerType,
          isPrimary: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        el.dispatchEvent(new PointerEvent('pointerdown', init));
        if (data.multi) el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 18, isPrimary: false }));
        for (const [dx, dy] of data.moves) el.dispatchEvent(new PointerEvent('pointermove', {
          ...init, clientX: init.clientX + dx, clientY: init.clientY + dy
        }));
        const [dx, dy] = data.end || data.moves.at(-1) || [0, 0];
        el.dispatchEvent(new PointerEvent(data.cancel ? 'pointercancel' : 'pointerup', {
          ...init, clientX: init.clientX + dx, clientY: init.clientY + dy
        }));
        if (data.multi) el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 18, isPrimary: false }));
        if (data.click) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
      }, { moves, end, cancel, multi, pointerType, click });
    }

    await settle();
    for (const scenario of [
      { moves: [[0, -14]] },
      { moves: [[0, 14]] },
      { moves: [[14, 0]] },
      { moves: [[8, 8]] },
      { moves: [[0, -18], [0, 0]] },
      { end: [0, -14] },
      { cancel: true },
      { multi: true },
      { moves: [[14, 0]], pointerType: 'pen' }
    ]) {
      await gesture(scenario);
      await assertClosed(JSON.stringify(scenario));
    }
    results.push('Short vertical, horizontal, diagonal and return-to-origin gestures, cancellation and multitouch reject ghost clicks');

    await gesture({ moves: [[3, 4]] });
    await closeViewer();
    await settle();
    await slide.tap();
    await closeViewer();
    results.push('Small finger jitter and a deliberate native tap still open the photo without an added timer');

    await settle();
    await slide.evaluate(el => el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 20, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: 100
    })));
    await page.waitForTimeout(650);
    await slide.evaluate(el => {
      el.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 20, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: 100
      }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    await assertClosed('Long press must not open a photo');
    results.push('Holding a photo does not turn into gallery opening on release');

    const cdp = await context.newCDPSession(page);
    async function touch(type, points) {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    }

    await settle();
    const box = await slide.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const before = await page.locator('.screen').evaluate(el => el.scrollTop);
    await touch('touchStart', [[x, y]]);
    for (let distance = 20; distance <= 160; distance += 20) {
      await touch('touchMove', [[x, y - distance]]);
      await page.waitForTimeout(20);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(600);
    assert.ok(await page.locator('.screen').evaluate(el => el.scrollTop) > before + 40, 'Photo must not block native vertical scrolling');
    await assertClosed('Vertical page swipe');
    results.push('Real touch input scrolls the page through a product photo without opening the viewer');

    await settle();
    await page.locator('.screen').evaluate(el => el.scrollBy(0, 20));
    await page.waitForTimeout(35);
    await gesture();
    await assertClosed('Tap that stops a still-moving page');
    await page.waitForTimeout(180);
    await slide.tap();
    await closeViewer();
    results.push('A tap while the page is settling is ignored; a fresh deliberate tap works after scrolling stops');

    await settle();
    for (const key of ['Enter', 'Space']) {
      await gesture({ cancel: true });
      await media.evaluate(el => { el.dataset.cardSuppressOpenUntil = String(Date.now() + 700); });
      await slide.focus();
      await page.keyboard.press(key);
      await closeViewer();
    }
    results.push('Enter and Space remain usable even immediately after a cancelled gesture');

    await settle();
    await gesture({ moves: [[0, -18]] });
    await media.locator('[data-share-product]').tap();
    await page.locator('#share-link-dialog').waitFor();
    await page.locator('[data-share-close]').tap();
    await page.waitForFunction(() => !document.querySelector('#share-link-dialog').open);
    await assertClosed('Sharing after a scroll gesture');
    results.push('Photo gesture filtering does not interfere with the Share button');

    await page.locator('[data-vitrine-filter="hit"]').tap();
    await page.locator('[data-vitrine-filter="all"]').tap();
    await settle();
    await gesture({ moves: [[0, -14]] });
    await assertClosed('Rerendered product cards');
    await slide.tap();
    await closeViewer();
    results.push('The guard remains active after switching catalog filters and rebuilding cards');

    fs.mkdirSync(out, { recursive: true });
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await settle();
      await gesture({ moves: [[0, -14]] });
      await assertClosed('Mobile width ' + width);
      await slide.tap();
      await closeViewer();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(out, 'catalog-' + width + '.png') });
    }
    results.push('Phone widths 320, 390 and 430 preserve taps and fit without horizontal overflow');
    await context.close();

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await desktop.route('**/rest/v1/analytics_events*', r => r.fulfill({ status: 201, body: '[]' }));
    const dp = await desktop.newPage();
    dp.on('pageerror', e => errors.push(e.message));
    await dp.goto(base, { waitUntil: 'domcontentloaded' });
    const ds = dp.locator('[data-card-slide="0"]').first();
    await ds.scrollIntoViewIfNeeded();
    const rect = await ds.boundingBox();
    await dp.mouse.move(rect.x + 80, rect.y + 80);
    await dp.mouse.down();
    await dp.mouse.move(rect.x + 100, rect.y + 80);
    await dp.mouse.up();
    assert.equal(await dp.locator('.otbasu-photo-viewer').count(), 0);
    await ds.click();
    await dp.locator('.otbasu-photo-viewer').waitFor();
    await dp.keyboard.press('Escape');
    await dp.locator('.otbasu-photo-viewer').waitFor({ state: 'detached' });
    await desktop.close();
    results.push('Desktop dragging does not open a photo; a normal mouse click still does');

    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
