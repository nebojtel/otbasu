// Run against a configured local preview with Playwright available.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.VITRINE_URL || 'http://127.0.0.1:5182/vitrine/';
const out = path.resolve(process.env.QA_OUTPUT_DIR || '../design-review/share-options');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const results = [];
  const errors = [];
  try {
    async function openPage(options, nativeMode) {
      const context = await browser.newContext(options);
      await context.route('**/rest/v1/analytics_events*', r => r.fulfill({ status: 201, body: '[]' }));
      // Messenger targets are intercepted: no messages or external requests are sent.
      await context.route('https://t.me/**', r => r.fulfill({ status: 200, body: 'Telegram test target' }));
      await context.route('https://wa.me/**', r => r.fulfill({ status: 200, body: 'WhatsApp test target' }));
      await context.addInitScript((mode) => {
        window.shareCalls = [];
        window.copyCalls = [];
        window.nativeMode = mode;
        Object.defineProperty(navigator, 'share', { configurable: true, value: mode === 'unsupported' ? undefined : async (data) => {
          window.shareCalls.push({ data, activated: navigator.userActivation.isActive });
          if (window.nativeMode === 'pending') return new Promise(resolve => { window.finishShare = resolve; });
          if (window.nativeMode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
          if (window.nativeMode !== 'success') throw new DOMException('Unavailable', window.nativeMode);
        } });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copyCalls.push(text); } } });
      }, nativeMode);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-share-product]').first().waitFor();
      return { context, page };
    }
    async function closeMenu(page, method = 'button') {
      if (method === 'back') await page.goBack();
      else if (method === 'backdrop') await page.touchscreen.tap(2, 2);
      else if (method === 'escape') await page.keyboard.press('Escape');
      else await page.locator('[data-share-close]').click();
      await page.waitForFunction(() => !document.querySelector('#share-link-dialog').open
        && document.activeElement.hasAttribute('data-share-product') && !history.state?.otbasuShareDialog);
    }

    const native = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 'pending');
    const np = native.page;
    await np.locator('[data-share-product]').first().tap();
    await np.waitForFunction(() => window.shareCalls.length === 1);
    assert.equal(await np.locator('[data-share-product]').first().isDisabled(), true);
    await np.locator('[data-share-product]').nth(1).dispatchEvent('click');
    assert.equal(await np.evaluate(() => window.shareCalls.length), 1);
    const nativeCall = await np.evaluate(() => window.shareCalls[0]);
    assert.equal(nativeCall.activated, true);
    assert.equal(new URL(nativeCall.data.url).searchParams.get('product'), await np.locator('.shop-card').first().getAttribute('data-product-id'));
    assert.equal(await np.locator('.otbasu-photo-viewer').count(), 0);
    await np.evaluate(() => window.finishShare());
    await np.waitForFunction(() => !document.querySelector('[data-share-product]').disabled);
    assert.equal(await np.locator('#share-link-dialog').isVisible(), false);
    assert.deepEqual(await np.evaluate(() => window.copyCalls), []);
    await np.evaluate(() => { window.nativeMode = 'cancel'; });
    await np.locator('[data-share-product]').first().tap();
    await np.waitForFunction(() => window.shareCalls.length === 2 && !document.querySelector('[data-share-product]').disabled);
    assert.equal(await np.locator('#share-link-dialog').isVisible(), false);
    assert.deepEqual(await np.evaluate(() => window.copyCalls), []);
    results.push('Native sharing retains user activation; duplicate taps and cancellation do not trigger copying or fallback');
    await native.context.close();

    const fallback = await openPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true }, 'unsupported');
    const page = fallback.page;
    const dialog = page.locator('#share-link-dialog');
    const startingHistory = await page.evaluate(() => history.length);
    await page.locator('[data-share-product]').first().tap();
    await dialog.waitFor();
    assert.equal(await page.locator('[data-share-native]').isVisible(), false);
    assert.equal(await page.locator('[data-share-manual]').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-share-close')), true);
    assert.deepEqual(await page.evaluate(() => window.copyCalls), []);
    const selectedUrl = await page.locator('#share-link-input').inputValue();
    const selectedTitle = await page.locator('[data-share-title]').textContent();
    for (const target of ['telegram', 'whatsapp']) {
      const link = page.locator('[data-share-target=' + target + ']');
      const href = await link.getAttribute('href');
      const parsed = new URL(href);
      assert.equal(parsed.origin, target === 'telegram' ? 'https://t.me' : 'https://wa.me');
      if (target === 'telegram') {
        assert.equal(parsed.searchParams.get('url'), selectedUrl);
        assert.equal(parsed.searchParams.get('text'), selectedTitle);
      } else assert.equal(parsed.searchParams.get('text'), selectedTitle + '\n' + selectedUrl);
      assert.ok((await link.getAttribute('rel')).includes('noopener'));
      const popupPromise = page.waitForEvent('popup');
      await link.tap();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      assert.equal(popup.url(), href);
      await popup.close();
    }
    const email = new URL(await page.locator('[data-share-target=email]').getAttribute('href'));
    assert.equal(email.protocol, 'mailto:');
    assert.equal(email.pathname, '');
    assert.equal(email.searchParams.get('body'), selectedTitle + '\n' + selectedUrl);
    await page.locator('[data-share-copy]').tap();
    await page.getByText('Ссылка на товар скопирована', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copyCalls), [selectedUrl]);
    assert.equal(await dialog.isVisible(), true);
    results.push('Unsupported browsers get Telegram, WhatsApp, email and explicit copy; messenger links open only on selection');

    for (const method of ['button', 'escape', 'back', 'backdrop']) {
      await closeMenu(page, method);
      await page.locator('[data-share-product]').first().tap();
      await dialog.waitFor();
    }
    assert.ok((await page.evaluate(() => history.length)) <= startingHistory + 1);
    results.push('Close, Escape, Back and backdrop dismiss the menu, restore focus and do not accumulate history entries');

    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
    await page.locator('[data-share-copy]').tap();
    await page.locator('[data-share-manual]').waitFor();
    const selection = await page.locator('#share-link-input').evaluate(n => ({ start: n.selectionStart, end: n.selectionEnd, length: n.value.length, focused: n === document.activeElement }));
    assert.deepEqual(selection, { start: 0, end: selectedUrl.length, length: selectedUrl.length, focused: true });
    await closeMenu(page);
    await page.locator('[data-share-product]').nth(1).tap();
    await dialog.waitFor();
    assert.equal(await page.locator('[data-share-manual]').isVisible(), false);
    assert.equal(await page.locator('[data-share-status]').textContent(), '');
    const otherUrl = await page.locator('#share-link-input').inputValue();
    assert.notEqual(otherUrl, selectedUrl);
    assert.equal(new URL(await page.locator('[data-share-target=telegram]').getAttribute('href')).searchParams.get('url'), otherUrl);
    results.push('Denied clipboard exposes a selected manual link; a new product clears previous state and replaces all share URLs');

    await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise(resolve => { window.finishCopy = resolve; }); });
    await page.locator('[data-share-copy]').tap();
    await closeMenu(page);
    await page.locator('[data-share-product]').first().tap();
    await dialog.waitFor();
    await page.evaluate(() => window.finishCopy());
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-share-status]').textContent(), '');
    assert.equal(await page.locator('[data-share-copy]').isEnabled(), true);
    results.push('Late clipboard completion cannot overwrite a newly opened product menu');

    const layouts = [];
    for (const [width, height] of [[320, 568], [360, 740], [390, 844], [430, 932], [740, 360]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      const metrics = await dialog.evaluate(n => {
        const r = n.getBoundingClientRect();
        return {
          width: innerWidth, height: innerHeight,
          contained: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight,
          overflow: n.scrollWidth > n.clientWidth || document.documentElement.scrollWidth > innerWidth,
          clipped: [...n.querySelectorAll('.share-option, h2')].some(el => el.scrollWidth > el.clientWidth + 1),
          targets: [...n.querySelectorAll('.share-option')].filter(el => !el.hidden).map(el => el.getBoundingClientRect().height),
          closeSize: n.querySelector('[data-share-close]').getBoundingClientRect().height
        };
      });
      assert.equal(metrics.contained, true);
      assert.equal(metrics.overflow, false);
      assert.equal(metrics.clipped, false);
      assert.ok(metrics.targets.every(h => h >= 52));
      assert.equal(metrics.closeSize, 44);
      layouts.push(metrics);
      await page.screenshot({ path: path.join(out, 'menu-' + width + '.png') });
    }
    results.push('Phone widths 320-430 and landscape keep the menu contained, readable and scrollable');
    await fallback.context.close();

    const failing = await openPage({ viewport: { width: 1440, height: 1000 } }, 'NotAllowedError');
    const fp = failing.page;
    await fp.locator('[data-share-product]').first().click();
    await fp.locator('#share-link-dialog').waitFor();
    assert.equal(await fp.locator('[data-share-native]').isVisible(), true);
    assert.deepEqual(await fp.evaluate(() => window.copyCalls), []);
    for (let i = 0; i < 10; i++) {
      await fp.keyboard.press(i === 0 ? 'Shift+Tab' : 'Tab');
      assert.equal(await fp.evaluate(() => document.querySelector('#share-link-dialog').contains(document.activeElement)), true);
    }
    await fp.locator('[data-share-native]').click();
    await fp.getByText('Системное меню недоступно в этом браузере.', { exact: true }).waitFor();
    await fp.evaluate(() => { window.nativeMode = 'cancel'; });
    await fp.locator('[data-share-native]').click();
    assert.equal(await fp.locator('#share-link-dialog').isVisible(), true);
    await fp.screenshot({ path: path.join(out, 'menu-desktop.png') });
    await fp.evaluate(() => { window.nativeMode = 'success'; });
    await fp.locator('[data-share-native]').click();
    await fp.waitForFunction(() => !document.querySelector('#share-link-dialog').open && !history.state?.otbasuShareDialog);
    assert.ok((await fp.evaluate(() => window.shareCalls)).every(call => call.activated));
    for (const mode of ['DataError', 'TypeError']) {
      await fp.evaluate(value => { window.nativeMode = value; }, mode);
      await fp.locator('[data-share-product]').first().click();
      await fp.locator('#share-link-dialog').waitFor();
      await closeMenu(fp);
    }
    results.push('Native failures open fallback; keyboard focus is trapped; retry has fresh activation and cancellation leaves options available');
    assert.deepEqual(errors, []);
    await failing.context.close();
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ results, layouts }, null, 2));
    console.log(JSON.stringify({ results, layouts }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
