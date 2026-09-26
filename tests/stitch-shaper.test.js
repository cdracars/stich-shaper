// Drives the real page in headless Chromium and checks what a crocheter sees.
// Stitch math: an inc works into 1 stitch, a dec (sc2tog) works into 2.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'stitch-shaper.html');

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

// Parses "[4 sc, inc] × 5, 5 sc, inc" and returns the stitches it works into.
function stitchesWorked(pattern, perChange) {
  let total = 0, changes = 0;
  const re = /\[(\d+) sc, (?:inc|dec)\] × (\d+)|(\d+) sc, (?:inc|dec)/g;
  let m;
  while ((m = re.exec(pattern))) {
    const gap = parseInt(m[1] ?? m[3], 10);
    const reps = m[2] ? parseInt(m[2], 10) : 1;
    total += reps * (gap + perChange);
    changes += reps;
  }
  const leftover = pattern.replace(re, '').replace(/[,\s]/g, '');
  assert.equal(leftover, '', `unparsed text in "${pattern}"`);
  return { total, changes };
}

test('By Count uneven increase: 31 st, 6 inc → whole-stitch gaps', async () => {
  await setInput('count-current', 31);
  await setInput('count-n', 6);
  await setDir('count-dir', 'inc');
  assert.equal(await text('count-pattern'), '[4 sc, inc] × 5, 5 sc, inc');
});

test('By Count patterns always work exactly the current stitches', async () => {
  for (const [dir, per] of [['inc', 1], ['dec', 2]]) {
    await setDir('count-dir', dir);
    for (const current of [7, 20, 31, 45]) {
      for (const n of [1, 3, 6, 7]) {
        if (n * per > current) continue;
        await setInput('count-current', current);
        await setInput('count-n', n);
        const pattern = await text('count-pattern');
        assert.ok(!pattern.includes('.'), `decimal in "${pattern}"`);
        const { total, changes } = stitchesWorked(pattern, per);
        assert.equal(total, current, `"${pattern}" for ${current} st, ${n} ${dir}`);
        assert.equal(changes, n);
      }
    }
  }
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
