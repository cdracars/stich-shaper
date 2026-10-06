// Drives the real page in headless Chromium and checks what a crocheter sees.
// Stitch math: an inc works into 1 stitch, a dec (sc2tog) works into 2.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'public', 'index.html');

let browser, page;

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
});

after(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await browser.newPage();
  // Fonts are cosmetic; skip the network so tests stay fast and offline.
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
});

async function openTab(panelId) {
  await page.click(`nav.tabbar .tab[data-panel="${panelId}"]`);
}

async function setInput(id, value) {
  await page.fill(`#${id}`, String(value));
}

async function setDir(toggleId, val) {
  await page.click(`#${toggleId} button[data-val="${val}"]`);
}

async function text(id) {
  return (await page.textContent(`#${id}`)).trim();
}

async function warnVisible(id) {
  return page.isVisible(`#${id}`);
}

// ---------- steppers ----------

test('+ button raises the value and recalculates', async () => {
  await page.click('button[data-target="count-n"][data-step="1"]');
  assert.equal(await page.inputValue('#count-n'), '7');
  assert.equal(await text('count-newtotal'), '37');
});

test('− button lowers the value and stops at the minimum', async () => {
  await setInput('count-n', 2);
  await page.click('button[data-target="count-n"][data-step="-1"]');
  assert.equal(await page.inputValue('#count-n'), '1');
  await page.click('button[data-target="count-n"][data-step="-1"]');
  assert.equal(await page.inputValue('#count-n'), '1');
});

// ---------- By Count ----------

test('By Count increase: 30 st, 6 inc → [4 sc, inc] × 6', async () => {
  await setInput('count-current', 30);
  await setInput('count-n', 6);
  await setDir('count-dir', 'inc');
  assert.equal(await text('count-pattern'), '[4 sc, inc] × 6');
  assert.equal(await text('count-regular'), '24');
  assert.equal(await text('count-newtotal'), '36');
  assert.equal(await warnVisible('count-warn'), false);
});

test('By Count decrease: 30 st, 6 dec → [3 sc, dec] × 6', async () => {
  await setInput('count-current', 30);
  await setInput('count-n', 6);
  await setDir('count-dir', 'dec');
  assert.equal(await text('count-pattern'), '[3 sc, dec] × 6');
  assert.equal(await text('count-regular'), '18');
  assert.equal(await text('count-newtotal'), '24');
  assert.equal(await warnVisible('count-warn'), false);
});

test('By Count increase in every stitch: 6 st, 6 inc → [0 sc, inc] × 6', async () => {
  await setInput('count-current', 6);
  await setInput('count-n', 6);
  await setDir('count-dir', 'inc');
  assert.equal(await text('count-pattern'), '[0 sc, inc] × 6');
  assert.equal(await text('count-newtotal'), '12');
});

test('By Count decrease needing more than the stitches you have warns', async () => {
  await setInput('count-current', 30);
  await setInput('count-n', 16);
  await setDir('count-dir', 'dec');
  assert.equal(await text('count-pattern'), '—');
  assert.equal(await warnVisible('count-warn'), true);
});

// ---------- By Gap ----------

test('By Gap increase: 30 st, gap 4 → 6 inc, [4 sc, inc] × 6', async () => {
  await openTab('panel-gap');
  await setInput('gap-current', 30);
  await setInput('gap-gap', 4);
  await setDir('gap-dir', 'inc');
  assert.equal(await text('gap-count'), '6');
  assert.equal(await text('gap-pattern'), '[4 sc, inc] × 6');
  assert.equal(await text('gap-newtotal'), '36');
  assert.equal(await warnVisible('gap-warn'), false);
});

test('By Gap decrease: 30 st, gap 3 → 6 dec, [3 sc, dec] × 6', async () => {
  await openTab('panel-gap');
  await setInput('gap-current', 30);
  await setInput('gap-gap', 3);
  await setDir('gap-dir', 'dec');
  assert.equal(await text('gap-count'), '6');
  assert.equal(await text('gap-pattern'), '[3 sc, dec] × 6');
  assert.equal(await text('gap-newtotal'), '24');
  assert.equal(await warnVisible('gap-warn'), false);
});

// ---------- Random ----------

async function randomSegments() {
  const chunks = await page.$$eval('#rand-segments span', (els) =>
    els.map((el) => parseInt(el.textContent, 10)));
  return chunks;
}

for (const [dir, perChange] of [['inc', 1], ['dec', 2]]) {
  test(`Random ${dir}: chunks plus ${dir}s use exactly the current stitches`, async () => {
    await openTab('panel-random');
    await setInput('rand-current', 30);
    await setInput('rand-n', 6);
    await setDir('rand-dir', dir);
    for (let i = 0; i < 25; i++) {
      await page.click('#reshuffle-btn');
      const chunks = await randomSegments();
      assert.equal(chunks.length, 6);
      chunks.forEach((c) => assert.ok(c >= 0, `negative chunk ${c}`));
      const worked = chunks.reduce((a, b) => a + b, 0) + 6 * perChange;
      assert.equal(worked, 30, `chunks ${chunks} don't work 30 stitches`);
    }
    const plain = 30 - 6 * perChange;
    assert.equal(await text('rand-check'), `${plain} / ${plain}`);
  });
}

test('Random decrease needing more than the stitches you have shows no chunks', async () => {
  await openTab('panel-random');
  await setInput('rand-current', 30);
  await setInput('rand-n', 16);
  await setDir('rand-dir', 'dec');
  assert.equal(await text('rand-pattern'), '—');
  assert.deepEqual(await randomSegments(), []);
});

// ---------- uneven splits must stay whole stitches ----------

// Expands a pattern like "(4 sc, inc, [5 sc, inc] × 2) × 2" into the list of
// sc gaps in the order they're worked, e.g. [4, 5, 5, 4, 5, 5].
function expandGaps(pattern) {
  const repeat = (inner, k) => Array(parseInt(k, 10)).fill(inner).join(', ');
  const flat = pattern
    .replace(/\(([^()]*)\) × (\d+)/g, (_, inner, k) =>
      repeat(inner.replace(/\[([^\]]*)\] × (\d+)/g, (_, i, r) => repeat(i, r)), k))
    .replace(/\[([^\]]*)\] × (\d+)/g, (_, inner, k) => repeat(inner, k));
  const re = /(\d+) sc, (?:inc|dec)/g;
  const leftover = flat.replace(re, '').replace(/[,\s]/g, '');
  assert.equal(leftover, '', `unparsed text in "${pattern}"`);
  return [...flat.matchAll(re)].map((m) => parseInt(m[1], 10));
}

// Every gap is one of two neighbouring sizes, and the bigger ones are spread
// around the round: after any i changes, the number of big gaps so far is
// within 1 of an even share.
function assertEvenlySpread(gaps, pattern) {
  const small = Math.min(...gaps);
  const bigs = gaps.filter((g) => g !== small).length;
  gaps.forEach((g) => assert.ok(g === small || g === small + 1, `"${pattern}"`));
  let seen = 0;
  gaps.forEach((g, i) => {
    if (g !== small) seen++;
    const share = ((i + 1) * bigs) / gaps.length;
    assert.ok(Math.abs(seen - share) <= 1, `big gaps bunched up in "${pattern}"`);
  });
}

test('By Count uneven increase: 31 st, 6 inc → whole-stitch gaps', async () => {
  await setInput('count-current', 31);
  await setInput('count-n', 6);
  await setDir('count-dir', 'inc');
  assert.equal(await text('count-pattern'), '[4 sc, inc] × 5, 5 sc, inc');
});

test('By Count patterns work exactly the current stitches, evenly spread', async () => {
  const cases = [[7, 1], [20, 3], [31, 6], [45, 7], [34, 6], [250, 100], [100, 30]];
  for (const [dir, per] of [['inc', 1], ['dec', 2]]) {
    await setDir('count-dir', dir);
    for (const [current, n] of cases) {
      if (n * per > current) continue;
      await setInput('count-current', current);
      await setInput('count-n', n);
      const pattern = await text('count-pattern');
      assert.ok(!pattern.includes('.'), `decimal in "${pattern}"`);
      const gaps = expandGaps(pattern);
      assert.equal(gaps.length, n, `"${pattern}" should have ${n} ${dir}s`);
      const worked = gaps.reduce((a, b) => a + b, 0) + n * per;
      assert.equal(worked, current, `"${pattern}" for ${current} st, ${n} ${dir}`);
      assertEvenlySpread(gaps, pattern);
    }
  }
});

test('By Count alternates gap sizes: 250 st, 100 inc', async () => {
  await setInput('count-current', 250);
  await setInput('count-n', 100);
  await setDir('count-dir', 'inc');
  assert.equal(await text('count-pattern'), '(1 sc, inc, 2 sc, inc) × 50');
});

test('By Gap uneven: 31 st, gap 4 → whole-stitch gaps', async () => {
  await openTab('panel-gap');
  await setInput('gap-current', 31);
  await setInput('gap-gap', 4);
  await setDir('gap-dir', 'inc');
  assert.equal(await text('gap-count'), '6');
  assert.equal(await text('gap-pattern'), '[4 sc, inc] × 5, 5 sc, inc');
});

test('By Gap picks the count whose gap is closest: 10 st, gap 6 → 2 inc', async () => {
  await openTab('panel-gap');
  await setInput('gap-current', 10);
  await setInput('gap-gap', 6);
  await setDir('gap-dir', 'inc');
  assert.equal(await text('gap-count'), '2');
  assert.equal(await text('gap-pattern'), '[4 sc, inc] × 2');
});

// ---------- remembering entries across visits ----------

test('By Count entries and direction survive leaving and coming back', async () => {
  await setInput('count-current', 40);
  await setInput('count-n', 8);
  await setDir('count-dir', 'dec');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.inputValue('#count-current'), '40');
  assert.equal(await page.inputValue('#count-n'), '8');
  assert.equal(await page.getAttribute('#count-dir button[data-val="dec"]', 'class'), 'on');
  assert.equal(await text('count-pattern'), '[3 sc, dec] × 8');
});

test('By Gap and Random entries survive, and so does the open tab', async () => {
  await openTab('panel-gap');
  await setInput('gap-current', 50);
  await setInput('gap-gap', 3);
  await setDir('gap-dir', 'dec');
  await openTab('panel-random');
  await setInput('rand-current', 24);
  await setInput('rand-n', 4);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.isVisible('#panel-random'), true);
  assert.equal(await page.inputValue('#rand-current'), '24');
  assert.equal(await page.inputValue('#rand-n'), '4');
  await openTab('panel-gap');
  assert.equal(await page.inputValue('#gap-current'), '50');
  assert.equal(await page.inputValue('#gap-gap'), '3');
  assert.equal(await text('gap-pattern'), '[3 sc, dec] × 10');
});

test('Stepper changes are remembered too', async () => {
  await page.click('button[data-target="count-n"][data-step="1"]');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.inputValue('#count-n'), '7');
});

test('Page still works when the browser blocks storage', async () => {
  const blocked = await browser.newPage();
  await blocked.route(/^https?:/, (route) => route.abort());
  await blocked.addInitScript(() => {
    const fail = () => { throw new Error('storage blocked'); };
    Storage.prototype.getItem = fail;
    Storage.prototype.setItem = fail;
  });
  await blocked.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  assert.equal((await blocked.textContent('#count-pattern')).trim(), '[4 sc, inc] × 6');
  await blocked.fill('#count-n', '5');
  assert.equal((await blocked.textContent('#count-newtotal')).trim(), '35');
  await blocked.close();
});

test('Page still works when the saved entries are garbage', async () => {
  for (const junk of ['not json', '{"panel":"x\\"]","toggles":{"count-dir":"in\\"c"},"inputs":5}', 'null']) {
    await page.evaluate((v) => localStorage.setItem('stitch-shaper:v1', v), junk);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await text('count-pattern'), '[4 sc, inc] × 6', `with saved value ${junk}`);
    await setInput('count-n', 5);
    assert.equal(await text('count-newtotal'), '35', `page stopped working with ${junk}`);
    await page.evaluate(() => localStorage.clear());
  }
});

test('A saved value below a field\'s minimum is not restored', async () => {
  await page.evaluate(() => localStorage.setItem('stitch-shaper:v1', JSON.stringify({
    inputs: { 'count-current': '30', 'count-n': '0' }, toggles: {}, panel: 'panel-count',
  })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const shown = await page.inputValue('#count-n');
  assert.notEqual(shown, '0', 'shows 0 changes while calculating with 1');
  assert.equal(await text('count-newtotal'), String(30 + parseInt(shown, 10)));
});

// ---------- Random split stays put between visits ----------

async function randomChunksText() {
  return page.$$eval('#rand-segments span', (els) => els.map((el) => el.textContent).join(' | '));
}

test('Random split is the same after leaving and coming back', async () => {
  await openTab('panel-random');
  await setInput('rand-current', 40);
  await setInput('rand-n', 8);
  const before = await randomChunksText();
  for (let i = 0; i < 5; i++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await randomChunksText(), before, `reload ${i + 1} gave a new split`);
  }
});

test('A reshuffled Random split is the one that comes back', async () => {
  await openTab('panel-random');
  await page.click('#reshuffle-btn');
  const shuffled = await randomChunksText();
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await randomChunksText(), shuffled);
});

test('A saved Random split that no longer adds up is replaced', async () => {
  await page.evaluate(() => localStorage.setItem('stitch-shaper:v1', JSON.stringify({
    inputs: { 'rand-current': '30', 'rand-n': '6' }, toggles: { 'rand-dir': 'inc' },
    panel: 'panel-random', randSegments: [99, 1, 1, 1, 1, 1],
  })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const chunks = await randomSegments();
  assert.equal(chunks.length, 6);
  assert.equal(chunks.reduce((a, b) => a + b, 0) + 6, 30);
});

test('Random split stays put for a save made before splits were remembered', async () => {
  // A save from the earlier version: entries but no randSegments.
  await page.evaluate(() => localStorage.setItem('stitch-shaper:v1', JSON.stringify({
    inputs: { 'rand-current': '30', 'rand-n': '6' }, toggles: { 'rand-dir': 'inc' },
    panel: 'panel-random',
  })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const first = await randomChunksText();
  // Just looking, no taps or typing, then coming back.
  for (let i = 0; i < 5; i++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await randomChunksText(), first, `visit ${i + 2} gave a new split`);
  }
});
