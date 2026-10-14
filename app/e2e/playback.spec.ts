// Playback verification through the sandboxed song runtime. Headless Chromium with --mute-audio only
// (see playwright.config.ts): the analyser still sees the signal, the speakers never do.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { exportsDir, serverPort } from './env';

const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__editor.current.setCode(c), code);
const rms = async (page: Page) => Number(await page.getByTestId('level-meter').getAttribute('data-rms'));
const probe = <T,>(page: Page, fn: string) => page.evaluate((f) => new Function('p', `return (${f})(p)`)((window as any).__runtime), fn) as Promise<T>;

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  // the runtime has loaded Strudel and the sound maps (page load is not what the 2 s budget measures)
  await page.waitForFunction(() => (window as any).__runtime?.ready === true, null, { timeout: 60_000 });
}

test('Play makes sound within 2 s and highlights active haps; Stop brings the level back to ~0', async ({ page }) => {
  await open(page);
  await setCode(page, 'note("c3 e3 g3 c4").s("sawtooth").gain(0.5)');   // synth: no sample download involved
  const clicked = Date.now();
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 2000, intervals: [50] }).toBeGreaterThan(0.001);
  expect(Date.now() - clicked).toBeLessThan(2000);
  // the runtime reports which haps are sounding and the editor outlines their source
  await expect(page.locator('.cm-content [style*="outline"]').first()).toBeVisible({ timeout: 2000 });
  await expect(page.getByTestId('level-meter')).toContainText(/-?\d+\.\d dB/);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 3000, intervals: [100] }).toBeLessThan(1e-4);
  await expect(page.locator('.cm-content [style*="outline"]')).toHaveCount(0);
});

// two synth sections at 2 cps: 2 s of choir, 8 s of bells; the first has a header comment above its pattern
const SECTIONS_SONG = `setcpm(120)
// ==== HYMN I: CHOIR A CAPPELLA ====
const choir = note("c3*4").s("sawtooth").gain(0.4)
const bells = note("e5*4").s("square").gain(0.3)
arrange(
  [4, choir], // Hymn I: choir a cappella
  [16, bells] // Bells
)`;
const getCode = (page: Page) => page.evaluate(() => (window as any).__editor.current.getCode() as string);

async function openSections(page: Page) {
  await open(page);
  await page.evaluate(() => { (window as any).__editorChanges = 0; });
  await setCode(page, SECTIONS_SONG);
  // a widget on each arrange() entry and on the matched header comment, plus the song widget on the
  // arrange( line and on line 1 (arrange() is further down)
  await expect(page.locator('.cm-section-widget.cm-sw-entry')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('.cm-section-widget.cm-sw-header')).toHaveCount(1);
  await expect(page.locator('.cm-song-widget')).toHaveCount(2);
  const lines = page.locator('.cm-content .cm-line');
  await expect(lines.nth(0).locator('.cm-song-widget')).toHaveCount(1);       // line 1
  await expect(lines.nth(1).locator('.cm-sw-header')).toContainText('0:00');
  await expect(lines.nth(4).locator('.cm-song-widget')).toHaveCount(1);       // the arrange( line
  await expect(lines.nth(6).locator('.cm-sw-entry')).toContainText('0:02');    // Bells starts at 2 s
}

test('the top bar has no play buttons; a section widget plays from that section and stops from it', async ({ page }) => {
  await openSections(page);
  await expect(page.getByRole('button', { name: /^(▶ Play|■ Stop)$/ })).toHaveCount(0);   // the old top-bar buttons
  await probe(page, 'p => p.reset()');
  await page.getByRole('button', { name: 'Play from Bells' }).first().click();
  await expect.poll(() => rms(page), { timeout: 2000, intervals: [50] }).toBeGreaterThan(0.001);
  // counted from the click: nothing from before the section start is triggered or reported (the run
  // starts at cycle 0 with the song shifted to the section), only the Bells section sounds
  await expect.poll(() => probe<number>(page, 'p => p.hapsSeen'), { timeout: 3000 }).toBeGreaterThan(4);
  expect(await probe<number>(page, 'p => p.minBegin')).toBeGreaterThanOrEqual(0);
  expect(await probe<string[]>(page, 'p => [...p.sounds]')).toEqual(['square']);
  // the playing section's widget turns into its stop button and is highlighted
  const stopBells = page.getByRole('button', { name: 'Stop Bells' }).first();   // entry + definition line
  await expect(stopBells).toBeVisible();
  await expect(page.locator('.cm-sw-active[data-section="1"]').first()).toBeVisible();   // entry (+ definition line)
  await expect(page.getByRole('button', { name: 'Stop song' })).toHaveCount(2);   // both song widgets turn to stop
  await stopBells.click();
  await expect.poll(() => rms(page), { timeout: 3000, intervals: [100] }).toBeLessThan(1e-4);
  await expect(page.locator('.cm-sw-active')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play song' }).first()).toBeVisible();
  // widgets are decorations: the document never changed after setCode
  expect(await getCode(page)).toBe(SECTIONS_SONG);
  expect(await page.evaluate(() => (window as any).__editorChanges)).toBe(1);
});

test('loop widget repeats one section (keyboard-operated); Cmd/Ctrl+. stops', async ({ page }) => {
  await openSections(page);
  await probe(page, 'p => p.reset()');
  const loop = page.getByRole('button', { name: 'Loop Hymn I: choir a cappella' }).first();
  await loop.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => rms(page), { timeout: 2000, intervals: [50] }).toBeGreaterThan(0.001);
  await expect(page.locator('.cm-sw-active[data-section="0"]')).toHaveCount(3);    // header + entry + definition
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3000);                         // past the 2 s section end: still the choir
  expect(await probe<string[]>(page, 'p => [...p.sounds]')).toEqual(['sawtooth']);
  await page.locator('.cm-content').getByText('const choir').click();
  await page.keyboard.press('ControlOrMeta+Period');
  await expect.poll(() => rms(page), { timeout: 3000, intervals: [100] }).toBeLessThan(1e-4);
  await expect(page.getByRole('button', { name: 'Play song' }).first()).toBeVisible();
  expect(await getCode(page)).toBe(SECTIONS_SONG);
});

test('Cmd/Ctrl+Enter plays the song with the first section active; the song widget stops it', async ({ page }) => {
  await openSections(page);
  await page.locator('.cm-content').getByText('const choir').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => rms(page), { timeout: 2000, intervals: [50] }).toBeGreaterThan(0.001);
  await expect(page.locator('.cm-sw-active[data-section="0"]').first()).toBeVisible();
  // the highlight moves on to Bells at 2 s
  await expect(page.locator('.cm-sw-active[data-section="1"]').first()).toBeVisible({ timeout: 4000 });
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 3000, intervals: [100] }).toBeLessThan(1e-4);
  expect(await getCode(page)).toBe(SECTIONS_SONG);
});

test('Run selection plays only the selected layer', async ({ page }) => {
  await open(page);
  await setCode(page, 'setcpm(60)\nstack(s("bd*2 sd"), s("hh*8"), note("c2").s("square"))');
  await expect(page.getByRole('button', { name: '▶ Run all' })).toBeVisible();   // nothing selected yet
  await page.locator('.cm-content').getByText('hh*8').dblclick();
  await page.getByRole('button', { name: '▶ Run selection' }).click();
  await expect(page.getByText(/Running: s\("hh\*8"\)/)).toBeVisible();
  await probe(page, 'p => p.reset()');
  await expect.poll(() => probe<number>(page, 'p => p.hapsSeen'), { timeout: 5000 }).toBeGreaterThan(8);
  expect(await probe<string[]>(page, 'p => [...p.sounds]')).toEqual(['hh']);
  // highlights land on the selected source, not on the other layers
  await expect(page.locator('.cm-content [style*="outline"]').first()).toHaveText(/hh|8/);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('moving an inline slider changes the value the runtime plays', async ({ page }) => {
  await open(page);
  await setCode(page, 's("hh*8").gain(slider(0.4, 0, 1))');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  const gain = () => probe<number | undefined>(page, 'p => p.lastHaps.find((h) => h.value.s === "hh")?.value.gain');
  await expect.poll(gain, { timeout: 5000 }).toBeCloseTo(0.4, 5);
  const input = page.locator('.cm-slider input[type=range]');
  await expect(input).toHaveCount(1);
  await input.evaluate((el: HTMLInputElement) => { el.value = '0.9'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(gain, { timeout: 3000 }).toBeCloseTo(0.9, 5);
  // the runtime echoed the update for the id the transpiler gave the slider (offset of its value)
  const at = 's("hh*8").gain(slider('.length;
  expect(await probe<Record<string, number>>(page, 'p => p.sliders')).toEqual({ [`slider_${at}`]: 0.9 });
  await expect(page.locator('.cm-content')).toContainText('slider(0.9, 0, 1)');
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('song code in the runtime cannot reach the API; the app can', async ({ page }) => {
  await open(page);
  const apiStatuses: { url: string; status: number; main: boolean }[] = [];
  page.on('response', (r) => { if (r.url().includes('/api/')) apiStatuses.push({ url: r.url(), status: r.status(), main: r.frame() === page.mainFrame() }); });
  await page.evaluate(() => {
    (window as any).__probes = [];
    window.addEventListener('message', (e) => { if (e.data?.probe) (window as any).__probes.push(e.data); });
  });
  // song code: report each attempt back to the page (the only channel it has)
  const song = [
    `const report = (probe, r) => parent.postMessage({ probe, ...r }, '*');`,
    `const tryFetch = (probe, url, init) => fetch(url, init).then((r) => report(probe, { status: r.status }), (e) => report(probe, { error: String(e) }));`,
    `tryFetch('relative', '/api/projects');`,
    `tryFetch('direct', 'http://127.0.0.1:${serverPort}/api/projects');`,
    `tryFetch('simple-post', '/api/projects', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ name: 'pwned' }) });`,
    `tryFetch('json-post', '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'pwned2' }) });`,
    `tryFetch('dev-source', '/src/api.ts');`,
    `s('bd')`,
  ].join('\n');
  await probe(page, `p => p.request({ type: 'check', code: ${JSON.stringify(song)} })`);
  await expect.poll(() => page.evaluate(() => (window as any).__probes.length), { timeout: 10_000 }).toBe(5);
  const probes = await page.evaluate(() => (window as any).__probes as { probe: string; status?: number; error?: string }[]);
  for (const p of probes) {
    // readable responses never come back; a no-cors POST yields an opaque status 0 response
    expect(String(p.status ?? p.error), p.probe).toMatch(p.probe === 'simple-post' ? /^0$/ : /TypeError|Failed to fetch/);
  }
  // any runtime-originated API response the browser surfaced is the server's 403
  for (const s of apiStatuses.filter((x) => !x.main)) expect(s.status, s.url).toBe(403);
  // the same requests with the runtime's `Origin: null`, through the Vite proxy and directly: refused, GET included
  for (const base of ['', `http://127.0.0.1:${serverPort}`]) {
    expect((await page.request.get(`${base}/api/projects`, { headers: { origin: 'null' } })).status(), `${base} GET`).toBe(403);
    expect((await page.request.post(`${base}/api/projects`, { headers: { origin: 'null', 'content-type': 'text/plain' }, data: '{"name":"pwned3"}' })).status(), `${base} POST`).toBe(403);
  }
  // nothing was created; the app's own calls still work
  const names = await page.evaluate(async () => (await (await fetch('/api/projects')).json()).map((p: { name: string }) => p.name));
  expect(names).not.toContain('pwned');
  expect(names).not.toContain('pwned2');
  expect(names).not.toContain('pwned3');
  expect(names.length).toBeGreaterThan(0);
});

test('evaluation errors show at the offending line and clear on the next good evaluate; setCode fires onChange once', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__editorChanges = 0; });
  await setCode(page, 's("bd")\nnote("c e").fast(\n');
  expect(await page.evaluate(() => (window as any).__editorChanges)).toBe(1);
  await page.getByRole('button', { name: 'Play song' }).first().click();
  const marked = page.locator('.cm-diagnostic-line-error');
  await expect(marked).toHaveCount(1);
  await expect(page.locator('.cm-diagnostic-msg')).toContainText(/Unexpected token/);
  // the marker sits on the reported line (3: the unexpected end of input)
  const lines = page.locator('.cm-content .cm-line');
  await expect(lines.nth(2)).toHaveClass(/cm-diagnostic-line-error/);
  await setCode(page, 's("bd")\nnote("c e").fast(2)\n');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect(marked).toHaveCount(0);
  await expect(page.locator('.cm-diagnostic-msg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('a long song renders in 60 s chunks to the exact length; small copy stays under 20 MB', async ({ page, request }) => {
  await open(page);
  // 130 s at 1 cps -> three render chunks; one onset per second
  await setCode(page, 'setcpm(60)\narrange([130, s("bd")])');
  await expect(page.locator('.cm-section-widget.cm-sw-entry')).toHaveCount(1);
  await page.getByLabel('Export options').click();
  await page.getByLabel('Also make a small copy (<20 MB)').check();
  await page.getByRole('button', { name: '⤓ Export' }).click();
  await expect(page.getByText(/Exported .*\.wav.*-small\.mp3/)).toBeVisible({ timeout: 90_000 });
  // other specs may have added projects: find the open one's id from its name in the sidebar
  const openName = ((await page.getByRole('navigation', { name: 'Projects' }).locator('[aria-current="page"] .project-name').textContent()) ?? '').trim();
  const project = ((await (await request.get('/api/projects')).json()) as { id: string; name: string }[]).find((p) => p.name === openName)!.id;
  const dir = await exportsDir(request, project);
  const wav = path.join(dir, `${project}.wav`);
  const header = Buffer.alloc(44);
  const fd = fs.openSync(wav, 'r'); fs.readSync(fd, header, 0, 44, 0); fs.closeSync(fd);
  expect(header.readUInt32LE(40)).toBe(130 * 48000 * 2 * 3);       // exact length, 24-bit stereo
  // onsets: one kick per second, none lost or doubled at the 60 s / 120 s seams
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'silencedetect=n=-50dB:d=0.3', '-f', 'null', '-']).stderr.toString();
  const silenceEnds = (log.match(/silence_end: ([\d.]+)/g) ?? []).map((l) => Number(l.split(': ')[1]));
  expect(silenceEnds.length).toBeGreaterThanOrEqual(128);
  expect(silenceEnds.length).toBeLessThanOrEqual(130);
  for (const t of silenceEnds) expect(Math.abs(t - Math.round(t)), `onset at ${t}`).toBeLessThan(0.02);
  const small = path.join(dir, `${project}-small.mp3`);
  expect(fs.statSync(small).size).toBeLessThan(20e6);
  expect(fs.statSync(small).size).toBeGreaterThan(1000);
});

test('located inspect issues are marked in the editor without playing', async ({ page }) => {
  await open(page);
  await setCode(page, 's("bd")\ns("bd [sd")');
  const lines = page.locator('.cm-content .cm-line');
  await expect(lines.nth(1)).toHaveClass(/cm-diagnostic-line-error/, { timeout: 10_000 });
  await expect(page.locator('.cm-diagnostic-msg')).toContainText('[mini] parse error at line 2');
  await setCode(page, 's("bd")\ns("bd [sd]")');
  await expect(page.locator('.cm-diagnostic-line-error')).toHaveCount(0, { timeout: 10_000 });
});

/** Share of pixels in an element's screenshot that differ clearly from the panel background. */
async function inkRatio(page: Page, png: Buffer) {
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 12) + Math.abs(d[i + 1] - 12) + Math.abs(d[i + 2] - 12) > 60) ink++;
    return ink / (d.length / 4);
  }, png.toString('base64'));
}

test('inline visuals (._pianoroll(), ._scope()) are drawn in the visuals panel', async ({ page }) => {
  await open(page);
  const panel = page.getByTestId('visuals-panel');
  await expect(panel).toBeHidden();
  await setCode(page, 'stack(\n  note("c3 e3 g3 b3").s("sawtooth").gain(0.3)._pianoroll(),\n  s("sine").note("a2").gain(0.4)._scope({ scale: 2 })\n)');
  // record the frame's size every time it enters panel mode: never an empty box
  await page.evaluate(() => {
    const f = document.querySelector('iframe.runtime-frame') as HTMLIFrameElement;
    (window as any).__panelBoxes = [];
    new MutationObserver(() => {
      if (f.classList.contains('panel')) { const r = f.getBoundingClientRect(); (window as any).__panelBoxes.push([r.width, r.height]); }
    }).observe(f, { attributes: true, attributeFilter: ['class', 'style'] });
  });
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect(panel).toBeVisible();
  const frame = page.locator('iframe.runtime-frame');
  await expect(frame).toHaveClass(/panel/);
  // the frame sits exactly over the panel, stays sandboxed and takes no pointer input
  await expect.poll(async () => {
    const [pb, fb] = [await panel.boundingBox(), await frame.boundingBox()];
    return pb !== null && pb.width > 0 && JSON.stringify(fb) === JSON.stringify(pb);
  }, { timeout: 5000 }).toBe(true);
  const boxes = await page.evaluate(() => (window as any).__panelBoxes as [number, number][]);
  expect(boxes.length).toBeGreaterThan(0);
  for (const [w, h] of boxes) expect(w > 1 && h > 1, `panel-mode frame ${w}x${h}`).toBe(true);
  expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(await frame.evaluate((f) => getComputedStyle(f).pointerEvents)).toBe('none');
  // both widget canvases are drawing (pianoroll bars + scope trace): clearly non-blank pixels
  await expect.poll(async () => inkRatio(page, await frame.screenshot()), { timeout: 5000 }).toBeGreaterThan(0.01);
  const canvases = page.frameLocator('iframe.runtime-frame').locator('#visuals canvas');
  await expect(canvases).toHaveCount(2);
  for (const i of [0, 1]) {
    const box = (await canvases.nth(i).boundingBox())!;
    const shot = await page.screenshot({ clip: box });
    expect(await inkRatio(page, shot), `widget ${i}`).toBeGreaterThan(0.002);
  }
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  // a song without visuals collapses the panel again
  await setCode(page, 's("hh*4")');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('renders split at quiet seams are sample-identical to a single pass; drones fall back to long / single-pass chunks', async ({ page }) => {
  await open(page);
  // compressor, cut groups, long releases, delay, reverb, noise and pattern-varying parameters across the seams
  const song = `setcpm(60)
stack(
  note("c3 [e3 g3] <b2 d3> a2").s("sawtooth").lpf(sine.range(400, 2000).slow(5)).release(1.5).gain(0.4).compressor("-20:8:10:.002:.05"),
  note("c5*3 e5").s("square").cut(1).decay(0.2).sustain(0.3).gain(0.15).delay(0.4).delaytime(0.375).delayfeedback(0.5),
  note("<c2 g1>").s("triangle").attack(0.5).release(3).gain(0.5).room(0.3).roomsize(1),
  s("white*4 crackle").decay(0.08).sustain(0).gain(0.1),
  note("<e3 a2>").s("supersaw").release(0.5).gain(0.15)
)`;
  // the same with a 40 s drone underneath: no quiet seam after the pre-roll cap
  const drone = song.replace('stack(', 'stack(\n  note("c2").s("sine").slow(40).gain(0.2),');
  const run = (code: string, chunking: object) => page.evaluate(async ([c, o]) => {
    const p = (window as any).__runtime;
    const single = await p.render(c, 0, 40, { targetSec: 1000, minSec: 1000, maxSec: 1000, longSec: 1000 });
    const chunked = await p.render(c, 0, 40, o);
    let max = 0, energy = 0;
    for (const ch of [0, 1]) for (let i = 0; i < single.channels[ch].length; i++) {
      max = Math.max(max, Math.abs(single.channels[ch][i] - chunked.channels[ch][i]));
      energy += single.channels[ch][i] ** 2;
    }
    return { max, energy, len: [single.channels[0].length, chunked.channels[0].length], kinds: [single.kinds, chunked.kinds], lengths: chunked.lengths, missing: [...single.missing, ...chunked.missing] };
  }, [code, chunking] as const);
  const small = { targetSec: 10, minSec: 5, maxSec: 20, longSec: 30, maxPrerollSec: 14 };
  const a = await run(song, small);
  expect(a.missing).toEqual([]);                                            // reverb and delay really play
  expect(a.kinds[0]).toEqual({ normal: 1, long: 0, single: 0 });
  expect(a.kinds[1]).toEqual({ normal: 4, long: 0, single: 0 });          // seams at 10, 20, 30 s
  expect(a.lengths).toEqual([10, 10, 10, 10].map((s) => s * 48000));
  expect(a.len).toEqual([40 * 48000, 40 * 48000]);
  expect(a.energy).toBeGreaterThan(100);                                    // not trivially silent
  expect(a.max).toBeLessThan(1e-4);
  // drone: the first chunk ends within the pre-roll cap, the rest is one long chunk ...
  const b = await run(drone, small);
  expect(b.missing).toEqual([]);
  expect(b.kinds[1]).toEqual({ normal: 1, long: 1, single: 0 });
  expect(b.max).toBeLessThan(1e-4);
  // ... or, when even longSec is too short, a single pass
  const c = await run(drone, { ...small, longSec: 25 });
  expect(c.kinds[1]).toEqual({ normal: 1, long: 0, single: 1 });
  expect(c.lengths).toEqual([10 * 48000, 30 * 48000]);
  expect(c.max).toBeLessThan(1e-4);
  // unclipped samples play their whole slice, past the hap's end: a long one-shot and a slowed-down drum
  const oneShots = `setcpm(60)
stack(
  note("<c2 ~ ~ ~ ~ ~ ~>").s("piano").gain(0.6),
  s("<bd ~ ~>").speed(0.25).gain(0.6),
  s("hh*4").gain(0.2)
)`;
  const d = await run(oneShots, small);
  expect(d.missing).toEqual([]);
  expect(d.energy).toBeGreaterThan(10);
  expect(d.max).toBeLessThan(1e-4);
});

test('the dev server refuses null-origin module requests that do not come from the runtime page', async ({ page }) => {
  await open(page);
  const base = { origin: 'null', 'sec-fetch-dest': 'script' };
  const own = new URL(page.url()).origin;
  expect((await page.request.get('/src/main.tsx', { headers: { ...base, referer: 'https://evil.example/' } })).status()).toBe(403);
  expect((await page.request.get('/src/main.tsx', { headers: base })).status()).toBe(403);
  expect((await page.request.get('/src/main.tsx', { headers: { ...base, referer: `${own}/runtime.html`, 'sec-fetch-dest': 'empty' } })).status()).toBe(403);
  const ok = await page.request.get('/src/runtime/main.ts', { headers: { ...base, referer: `${own}/runtime.html` } });
  expect(ok.status()).toBe(200);
  expect(ok.headers()['access-control-allow-origin']).toBe('null');
});

test('hap values cannot style the editor: markcss is dropped, only plain colours are used', async ({ page }) => {
  await open(page);
  const evil = 'background: url(https://evil.example/x.png); position: fixed';
  await setCode(page, `s("hh*8").gain(0.3).withValue((v) => ({ ...v, markcss: '${evil}', color: 'red; background: blue' }))`);
  await page.getByRole('button', { name: 'Play song' }).first().click();
  const marks = page.locator('.cm-content [style*="outline"]');
  await expect(marks.first()).toBeVisible({ timeout: 3000 });
  const styles = await page.locator('.cm-content [style]').evaluateAll((els) => els.map((e) => e.getAttribute('style') ?? ''));
  expect(styles.join('\n')).not.toMatch(/evil\.example|position|background: blue|red;/);
  expect(await marks.first().getAttribute('style')).toMatch(/^outline: solid 2px var\(--foreground\);?$/);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  // a plain colour still works
  await setCode(page, 's("hh*8").gain(0.3).color("cyan")');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect(page.locator('.cm-content [style*="outline"][style*="cyan"]').first()).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('song code cannot raise the audio unlock overlay or re-run the handshake', async ({ page }) => {
  await open(page);
  // song code grabs the runtime's port on its next message and posts audioBlocked through it,
  // then posts a fresh HELLO to the parent
  const song = [
    `const orig = MessagePort.prototype.postMessage;`,
    `MessagePort.prototype.postMessage = function (m, t) { MessagePort.prototype.postMessage = orig; orig.call(this, m, t); orig.call(this, { type: 'audioBlocked' }); };`,
    `parent.postMessage({ type: 'shawarma-runtime:hello' }, '*');`,
    `setTimeout(() => parent.postMessage({ type: 'shawarma-runtime:hello' }, '*'), 200);`,
    `s('bd')`,
  ].join('\n');
  await probe(page, `p => p.request({ type: 'check', code: ${JSON.stringify(song)} })`);
  await page.waitForTimeout(800);
  const frame = page.locator('iframe.runtime-frame');
  await expect(frame).not.toHaveClass(/unlock/);
  expect(await frame.boundingBox()).toMatchObject({ width: 1, height: 1 });
  await expect(page.locator('.unlock-note')).toBeHidden();
  // still the same connection: requests keep working and playback is unaffected
  expect(await probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`)).toEqual({ cps: 0.5 });
  await setCode(page, 'note("c3 e3").s("sawtooth").gain(0.4)');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 2000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('offline renders keep reverb and delay (no "missing sound"), with the same room every time', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const p = (window as any).__runtime;
    const o = { targetSec: 1000, minSec: 1000, maxSec: 1000, longSec: 1000 };
    const tail = (ch: Float32Array) => { let e = 0; for (let i = 0.5 * 48000; i < 48000; i++) e += ch[i] ** 2; return e; };
    const dry = await p.render('setcpm(60)\nnote("c3 ~ ~ ~").s("triangle").release(0.05)', 0, 2, o);
    const wet = await p.render('setcpm(60)\nnote("c3 ~ ~ ~").s("triangle").release(0.05).room(1).roomsize(2)', 0, 2, o);
    const wet2 = await p.render('setcpm(60)\nnote("c3 ~ ~ ~").s("triangle").release(0.05).room(1).roomsize(2)', 0, 2, o);
    const dly = await p.render('setcpm(60)\nnote("c3 ~ ~ ~").s("triangle").release(0.05).delay(0.5).delaytime(0.3)', 0, 2, o);
    let d = 0; for (let i = 0; i < wet.channels[0].length; i++) d = Math.max(d, Math.abs(wet.channels[0][i] - wet2.channels[0][i]));
    return { missing: [...dry.missing, ...wet.missing, ...dly.missing], dry: tail(dry.channels[0]), wet: tail(wet.channels[0]), dly: tail(dly.channels[0]), same: d };
  });
  expect(r.missing).toEqual([]);
  expect(r.dry).toBe(0);              // the note is over by 0.5 s ...
  expect(r.wet).toBeGreaterThan(0.1); // ... the room and the echoes are not
  expect(r.dly).toBeGreaterThan(0.1);
  expect(r.same).toBe(0);             // reverb impulse responses are seeded, not random per render
});

test('a song that navigates the runtime away gets it reset and reloaded; a forged HELLO from the new page is refused', async ({ page }) => {
  await open(page);
  const frame = page.locator('iframe.runtime-frame');
  const src = (await frame.getAttribute('src'))!;
  expect(src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/runtime\.html\?n=[0-9a-f]{32}$/);
  await setCode(page, 'note("c3 e3").s("sawtooth").gain(0.4)');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 2000 }).toBeGreaterThan(0.001);
  // song code replaces the runtime document with its own page, which claims to be the runtime
  const page2 = `<script>for (let i = 0; i < 20; i++) setTimeout(() => parent.postMessage({ type: 'shawarma-runtime:hello', href: 'http://localhost/runtime.html' }, '*'), i * 20)</script>`;
  const url = `data:text/html,${encodeURIComponent(page2).replace(/'/g, '%27')}`;
  await probe(page, `p => p.request({ type: 'check', code: ${JSON.stringify(`setTimeout(() => { location.href = '${url}' }, 50); s('bd')`)} })`);
  await expect(page.getByText('Song runtime reloaded')).toBeVisible({ timeout: 5000 });
  expect(await probe<number>(page, 'p => p.reloads')).toBe(1);
  // playback stopped, the parent loaded runtime.html again itself, and it works
  await expect.poll(() => rms(page), { timeout: 3000 }).toBeLessThan(1e-4);
  const src2 = (await frame.getAttribute('src'))!;
  expect(src2).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/runtime\.html\?n=[0-9a-f]{32}$/);
  expect(src2).not.toBe(src);                                     // a fresh nonce for every load
  await expect.poll(() => probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`), { timeout: 20_000 }).toEqual({ cps: 0.5 });
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 3000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  // a plain about:blank navigation is handled the same way
  await probe(page, `p => p.request({ type: 'check', code: "setTimeout(() => { location.href = 'about:blank' }, 50); s('bd')" })`);
  await expect.poll(() => probe<number>(page, 'p => p.reloads'), { timeout: 5000 }).toBe(2);
  await expect.poll(() => probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`), { timeout: 20_000 }).toEqual({ cps: 0.5 });
});

test('a navigation chain ending in a page that forges HELLO (guessed href, stale nonce) never gets the port', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    (window as any).__forged = [];
    window.addEventListener('message', (e) => { if (e.data?.forgedProbe) (window as any).__forged.push(e.data); });
  });
  // page 2: forges HELLO with everything it could know, and reports anything it is sent
  const page2 = `<script>
    const nonce = new URLSearchParams(location.hash.slice(1)).get('n');
    parent.postMessage({ forgedProbe: 'alive', nonce }, '*');
    addEventListener('message', (e) => parent.postMessage({ forgedProbe: 'received', type: e.data && e.data.type, ports: e.ports.length }, '*'));
    for (let i = 0; i < 100; i++) setTimeout(() => parent.postMessage({ type: 'shawarma-runtime:hello', nonce, href: 'http://localhost/runtime.html' }, '*'), i * 20);
  </script>`;
  // page 1: on load, navigates on at once (setTimeout 0), to consume whatever the parent expects
  const page1 = (url2: string) => `<script>onload = () => setTimeout(() => { location.href = ${JSON.stringify(url2)} + location.hash }, 0)</script>`;
  const enc = (h: string) => `data:text/html,${encodeURIComponent(h).replace(/'/g, '%27')}`;
  const url1 = enc(page1(enc(page2)));
  // song code in the real runtime reads the (already used) nonce and starts the chain
  await probe(page, `p => p.request({ type: 'check', code: ${JSON.stringify(`const n = new URLSearchParams(location.search).get('n'); setTimeout(() => { location.href = '${url1}#n=' + n }, 50); s('bd')`)} })`);
  await expect.poll(() => probe<number>(page, 'p => p.reloads'), { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  // the parent recovers on its own (reloads with a new nonce) and requests work again
  await expect.poll(() => probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`), { timeout: 30_000 }).toEqual({ cps: 0.5 });
  await setCode(page, 'note("c3 e3").s("sawtooth").gain(0.4)');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 3000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
  // the forged page never received a CONNECT or a port (nor anything else); usually it never even runs,
  // since the first foreign load already replaces the whole frame element
  const forged = await page.evaluate(() => (window as any).__forged as { forgedProbe: string; nonce?: string }[]);
  expect(forged.filter((f) => f.forgedProbe !== 'alive')).toEqual([]);
  await expect(page.locator('iframe.runtime-frame')).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:\d+\/runtime\.html\?n=[0-9a-f]{32}$/);
});

test('a document that lands between HELLO and the load event gets a port but never a request; the app recovers', async ({ page }) => {
  // the reviewer's race, forced: right after each of the runtime's first 3 HELLOs the frame is navigated
  // to a data: page, whose load event is the one the app sees; that page tries everything it can
  const evil = `<script>
    addEventListener('message', (e) => {
      parent.postMessage({ forgedProbe: 'got', type: e.data && e.data.type, ports: e.ports.length, keys: Object.keys(e.data || {}) }, '*');
      const port = e.ports[0];
      if (!port) return;
      port.onmessage = (m) => parent.postMessage({ forgedProbe: 'request', req: m.data }, '*');
      port.postMessage({ type: 'ack', nonce: 'guess' });
      port.postMessage({ type: 'audioBlocked' });
      port.postMessage({ type: 'levels', peak: [0.9], rms: [0.9] });
    });
  </script>`;
  await page.addInitScript((url) => {
    // once per runtime load (the runtime repeats HELLO until connected), for the first three loads
    const seen = new Set<string>();
    (window as any).__forged = [];
    addEventListener('message', (e) => {
      if (e.data?.forgedProbe) (window as any).__forged.push(e.data);
      if (e.data?.type === 'shawarma-runtime:hello' && !seen.has(e.data.nonce) && seen.size < 3) {
        seen.add(e.data.nonce);
        document.querySelector('iframe.runtime-frame')!.setAttribute('src', url);
      }
    });
    (window as any).__hijacks = () => seen.size;
  }, `data:text/html,${encodeURIComponent(evil)}`);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  // a request made during all this never hangs: it is answered by the real runtime, or (if it went out
  // to a runtime that was then navigated away) rejected as reloaded
  const early = page.evaluate(() => (window as any).__runtime.request({ type: 'check', code: 's("bd")' }).then((r: unknown) => r, (e: Error) => e.message));
  await page.waitForFunction(() => (window as any).__hijacks() === 3, null, { timeout: 30_000 });
  const settled = await Promise.race([early, new Promise((r) => setTimeout(() => r('hung'), 40_000))]);
  expect(settled === 'song runtime reloaded' || JSON.stringify(settled) === '{"cps":0.5}', JSON.stringify(settled)).toBe(true);
  await expect.poll(() => probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`), { timeout: 30_000 }).toEqual({ cps: 0.5 });
  // whichever way each race went (the hijacking page or the real runtime got the port first), a hijacking
  // page that got CONNECT found no nonce in it, nothing was ever sent on its port, and its fake ACK and
  // messages did nothing (the handshake logic is covered deterministically in handshake.test.ts)
  const forged = await page.evaluate(() => (window as any).__forged as any[]);
  expect(forged.filter((f) => f.forgedProbe === 'got').every((f) => f.type === 'shawarma-runtime:connect' && f.keys.join() === 'type')).toBe(true);
  expect(forged.filter((f) => f.forgedProbe === 'request')).toEqual([]);
  await expect(page.locator('iframe.runtime-frame')).not.toHaveClass(/unlock/);
  // the real runtime works
  await setCode(page, 'note("c3 e3").s("sawtooth").gain(0.4)');
  await page.getByRole('button', { name: 'Play song' }).first().click();
  await expect.poll(() => rms(page), { timeout: 3000 }).toBeGreaterThan(0.001);
  await page.getByRole('button', { name: 'Stop song' }).first().click();
});

test('a runtime that stops answering is reset and reloaded instead of leaving requests hanging', async ({ page }) => {
  await open(page);
  // straight to the runtime: the server pre-flight would refuse this song before it runs
  await page.evaluate(() => { (window as any).__runtime.timeouts.default = 3000; (window as any).__runtime.withoutPrecheck(); });
  // the runtime never answers (its evaluation waits forever; the page itself stays responsive)
  const busy = `await new Promise(() => {}); s('bd')`;
  const t = Date.now();
  const r = await page.evaluate((code) => (window as any).__runtime.request({ type: 'check', code }).then(() => 'answered', (e: Error) => e.message), busy);
  expect(r).toMatch(/stopped answering|A loop in the song ran for more than/);
  expect(Date.now() - t).toBeLessThan(10_000);
  await expect.poll(() => probe<number>(page, 'p => p.reloads'), { timeout: 5000 }).toBe(1);
  await expect(page.getByText('Song runtime reloaded')).toBeVisible();
  await expect.poll(() => probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`), { timeout: 30_000 }).toEqual({ cps: 0.5 });
});

test('a song that spins forever cannot freeze the app: the runtime is cross-site, times out and is replaced', async ({ page }) => {
  await open(page);
  // the runtime document is on the other loopback hostname: another site, so another process
  const src = (await page.locator('iframe.runtime-frame').getAttribute('src'))!;
  expect(new URL(src).hostname).toBe('127.0.0.1');
  expect(new URL(page.url()).hostname).toBe('localhost');
  await page.evaluate(() => {
    (window as any).__ticks = 0;
    setInterval(() => { (window as any).__ticks++; }, 50);
    (window as any).__runtime.timeouts.default = 3000;
    // the one kind of spin the other defences cannot see (no pre-flight, a loop built from a string so
    // the loop guards never touch it): only process isolation keeps the app alive
    (window as any).__runtime.withoutPrecheck();
    (window as any).__spin = 'pending';
    (window as any).__runtime.request({ type: 'check', code: "Function('while (true) {}')(); s('bd')" })
      .then(() => { (window as any).__spin = 'answered'; }, (e: Error) => { (window as any).__spin = e.message; });
  });
  // the app keeps running while the runtime spins: its timers fire and the page answers at once
  const ticks0 = await page.evaluate(() => (window as any).__ticks);
  await page.waitForTimeout(1500);
  const ticks1 = await page.evaluate(() => (window as any).__ticks);
  expect(ticks1 - ticks0).toBeGreaterThan(15);
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.locator('.modal-backdrop')).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  // the request times out, the spinning frame is replaced and a new runtime loads
  await expect.poll(() => page.evaluate(() => (window as any).__spin), { timeout: 10_000 }).toMatch(/stopped answering|A loop in the song ran for more than/);
  // a timeout replaces the frame; the loop guard (which now also covers Function()) stops it in place
  if (/stopped answering/.test(await page.evaluate(() => (window as any).__spin))) {
    await expect.poll(() => probe<number>(page, 'p => p.reloads'), { timeout: 5000 }).toBe(1);
  }
  await expect.poll(() => probe<{ cps: number }>(page, `p => p.request({ type: 'check', code: 's("hh")' })`), { timeout: 30_000 }).toEqual({ cps: 0.5 });
  await setCode(page, 'note("c3 e3").s("sawtooth").gain(0.4)');
  await page.evaluate(() => { (window as any).__runtime.timeouts.default = 30_000; });
  await page.locator('.cm-content').click();                       // a user gesture for the new frame's audio
  expect(await page.evaluate(() => (window as any).__editor.current.play().then(() => 'ok', (e: Error) => e.message))).toBe('ok');
  await expect.poll(() => rms(page), { timeout: 5000 }).toBeGreaterThan(0.001);
  await page.evaluate(() => (window as any).__editor.current.stop());
});
