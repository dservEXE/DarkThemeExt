// Functional checks run in an isolated temporary Brave profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

function isDark(color) {
  const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return rgb && Math.max(...rgb) < 110;
}
async function waitDark(page, selector = 'body') {
  await page.waitForFunction((s) => {
    const element = document.querySelector(s);
    const rgb = element && getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    return rgb && Math.max(...rgb) < 110;
  }, selector);
}

(async () => {
  const artifacts = path.join(root, 'verification');
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url === '/never.js') return; // Keep another tab loading indefinitely.
    if (req.url === '/slow') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html><head><script src="/never.js"></script></head><body>Loading tab</body></html>');
      return;
    }
    if (req.url === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end('.remote-card { background: #fafafa; color: #151515; border: 1px solid #ddd; padding: 20px; }');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const port = server.address().port;
    res.end(`<!doctype html><html><head><title>Night Sites fixture</title>
      <link rel="stylesheet" href="http://localhost:${port}/fixture.css">
      <style>body{background:#fff;color:#111;font:20px sans-serif} .card{background:white;color:#111;padding:20px} input{background:white;color:black}</style>
      </head><body><h1>Текст остаётся читаемым</h1><div class="card">Карточка</div>
      <div class="remote-card">Cross-origin stylesheet</div><input value="Поле формы">
      <img alt="sample" width="120" height="80" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Cpath fill='red' d='M0 0h60v80H0z'/%3E%3Cpath fill='green' d='M60 0h60v80H60z'/%3E%3C/svg%3E">
      ${req.url === '/frame' ? '' : `<iframe src="http://localhost:${port}/frame"></iframe>`}
      </body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const fixture = `http://127.0.0.1:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'night-sites-test-'));
  let context;
  const checks = [];
  function pass(message) { checks.push(message); console.log(`PASS: ${message}`); }
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.BRAVE_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
      headless: true,
      viewport: { width: 1440, height: 1000 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', `--load-extension=${path.join(root, 'extension')}`]
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const { extensions } = await cdp.send('Extensions.getExtensions');
    const extension = extensions.find((item) => item.name.startsWith('Night Sites'));
    assert.ok(extension?.enabled);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = context.pages()[0];
    page.on('pageerror', (error) => console.log(`PAGE ERROR: ${error.message}`));
    await page.goto(fixture);
    assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    pass('extension loads in Brave and starts switched off');

    const loadingTab = await context.newPage();
    await loadingTab.goto(fixture + 'slow', { waitUntil: 'commit' });

    // Open the real extension UI in an inactive tab, while the test site remains
    // active. This uses actual extension APIs, not a simulated chrome object.
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extension.id}/popup.html`);
    await popup.locator('#global-toggle:not([disabled])').waitFor();
    assert.equal(await popup.locator('#host').innerText(), '127.0.0.1');
    await popup.locator('#global-toggle').click();
    await popup.locator('#global-toggle:not([disabled])').waitFor({ timeout: 1500 });
    pass('popup unlocks while another tab is still loading');
    assert.equal(await popup.locator('#global-toggle').getAttribute('aria-checked'), 'true');
    for (const enabled of [false, true, false, true]) {
      await popup.locator('#global-toggle').click();
      await popup.locator('#global-toggle:not([disabled])').waitFor({ timeout: 1500 });
      assert.equal(await popup.locator('#global-toggle').getAttribute('aria-checked'), String(enabled));
    }
    pass('global switch can be clicked repeatedly in the same popup');
    await waitDark(page);
    await waitDark(page, '.card');
    await waitDark(page, '.remote-card');
    const frame = page.frames().find((item) => item.url().includes('/frame'));
    await frame.waitForFunction(() => document.documentElement.getAttribute('data-darkreader-mode') === 'dynamic');
    assert.ok(isDark(await frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)));
    assert.equal(await page.locator('img').evaluate((el) => getComputedStyle(el).filter), 'none');
    pass('real popup applies independent dark colors to text, cards, CORS CSS and cross-origin frames; photo filter stays unchanged');

    await page.evaluate(() => {
      const card = document.createElement('div');
      card.id = 'dynamic';
      card.style.cssText = 'background: rgb(255,255,255); color: black';
      card.textContent = 'Added after load';
      document.body.append(card);
    });
    await waitDark(page, '#dynamic');
    pass('dynamically inserted content becomes dark');

    await popup.locator('#site-toggle').click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-darkreader-mode'));
    assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    await frame.waitForFunction(() => !document.documentElement.hasAttribute('data-darkreader-mode'));
    pass('per-site exclusion restores original colors including child frames');
    await popup.locator('#site-toggle:not([disabled])').waitFor();
    await popup.locator('#site-toggle').click();
    await waitDark(page);
    pass('removing an exclusion reapplies the theme without reloading');

    await popup.locator('#brightness').fill('80');
    await popup.locator('#brightness').dispatchEvent('change');
    await popup.locator('#global-toggle:not([disabled])').waitFor();
    assert.equal((await worker.evaluate(() => chrome.storage.local.get('brightness'))).brightness, 80);
    await popup.locator('#reset').click();
    await popup.locator('#global-toggle:not([disabled])').waitFor();
    assert.equal((await worker.evaluate(() => chrome.storage.local.get('brightness'))).brightness, 100);
    pass('brightness control and reset persist their values');
    for (const value of [75, 105, 90, 100]) {
      await popup.locator('#brightness').fill(String(value));
      await popup.locator('#brightness').dispatchEvent('change');
      await popup.locator('#brightness:not([disabled])').waitFor({ timeout: 1500 });
      assert.equal((await worker.evaluate(() => chrome.storage.local.get('brightness'))).brightness, value);
    }
    pass('brightness slider stays usable after repeated changes without reopening the popup');
    await loadingTab.close();

    await page.reload();
    await waitDark(page);
    pass('theme persists across page reload');

    // Test the real public university page without authentication or credentials.
    await page.goto('https://lk.donstu.ru/webapp/', { waitUntil: 'domcontentloaded' });
    await page.locator('.v-application').waitFor();
    await page.waitForFunction(() => document.body.innerText.trim().length > 100, null, { timeout: 45000 });
    console.log('UNIVERSITY PAGE: ' + (await page.locator('body').innerText()).slice(0, 700));
    await page.waitForFunction(() => document.documentElement.getAttribute('data-darkreader-mode') === 'dynamic');
    assert.equal(await page.evaluate(() => localStorage.getItem('baseTheme')), null);
    await page.screenshot({ path: path.join(artifacts, 'donstu-dark.png'), animations: 'disabled' });
    pass('independent theme runs on the university login page without changing its native theme setting');

    await popup.reload();
    await popup.locator('#global-toggle:not([disabled])').waitFor();
    assert.equal(await popup.locator('#host').innerText(), 'lk.donstu.ru');
    const denied = await popup.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (resourceUrl) => chrome.runtime.sendMessage({ type: 'ns-fetch', url: resourceUrl }),
        args: [url]
      });
      return result.result;
    }, fixture + 'fixture.css');
    assert.equal(denied.ok, false);
    pass('public pages cannot fetch local-network resources through the extension');
    await popup.locator('main').screenshot({ path: path.join(artifacts, 'popup.png'), animations: 'disabled' });
    await popup.locator('#global-toggle').click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-darkreader-mode'));
    await page.screenshot({ path: path.join(artifacts, 'donstu-original.png'), animations: 'disabled' });
    pass('global off restores the original university page');

    await page.goto('brave://settings/');
    await popup.reload();
    await popup.locator('#global-toggle:not([disabled])').waitFor();
    assert.equal(await popup.locator('#site-toggle').isDisabled(), true);
    assert.equal(await popup.locator('#host').innerText(), 'Служебная страница');
    pass('internal browser pages show a disabled per-site control');
    fs.writeFileSync(path.join(artifacts, 'result.txt'), [
      `Brave engine: ${await context.browser().version()}`,
      'Tests used a temporary profile without credentials.',
      'Authenticated university sections were not inspected.',
      ...checks.map((item) => `PASS: ${item}`)
    ].join('\n') + '\n');
  } finally {
    if (context) await context.close();
    await new Promise((resolve) => server.close(resolve));
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('night-sites-test-')) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
