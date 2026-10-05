import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

type Sample = { frames: number; p50: number; p95: number; max: number; longTasks: number; cardsMutated: number };

const WINDOW_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function viewport(page: Page) {
	// DOMMatrixReadOnly is a browser global, so the parse has to run inside the page.
	return page.locator('.svelte-flow__viewport').evaluate((el) => {
		const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
		return { x: Math.round(m.e), y: Math.round(m.f), zoom: Math.round(m.a * 1000) / 1000 };
	});
}

/** Resolves once the viewport has stopped moving (Fit and the follow animation both ease for ~250 ms). */
async function settled(page: Page) {
	let last = JSON.stringify(await viewport(page));
	for (let stable = 0; stable < 3; ) {
		await sleep(150);
		const now = JSON.stringify(await viewport(page));
		stable = now === last ? stable + 1 : 0;
		last = now;
	}
}

/** A point on the bare pane (not a card, control or the minimap), with room for the pan path around it. */
async function emptyCanvasPoint(page: Page) {
	const point = await page.evaluate(() => {
		const r = document.querySelector('.svelte-flow__pane')!.getBoundingClientRect();
		for (let y = r.top + 150; y < r.bottom - 150; y += 23)
			for (let x = r.left + 150; x < r.right - 300; x += 31)
				if (document.elementFromPoint(x, y)?.classList.contains('svelte-flow__pane')) return { x, y };
		return null;
	});
	if (!point) throw new Error('no empty canvas point on screen');
	return point;
}

/** Runs `n` units of fixed CPU work in the page; with no `n`, calibrates `n` to take about 20 ms. */
function busyWork(page: Page, n?: number) {
	return page.evaluate((units) => {
		const run = (count: number) => {
			let acc = 0;
			for (let c = 0; c < count; c++) for (let k = 0; k < 1000; k++) acc += Math.sqrt(k + c);
			(window as unknown as { __sink: number }).__sink = acc;
		};
		if (units === undefined) {
			let count = 1;
			while (true) {
				const t = performance.now();
				run(count);
				const ms = performance.now() - t;
				if (ms >= 20) return { n: count, ms };
				count = Math.ceil(count * Math.max(1.2, 22 / Math.max(ms, 0.1)));
			}
		}
		const t = performance.now();
		run(units);
		return { n: units, ms: performance.now() - t };
	}, n);
}

/** The fastest of three runs, so a JIT warm-up or a stray GC pause does not skew the comparison. */
async function fastest(page: Page, n: number) {
	let best = await busyWork(page, n);
	for (let i = 0; i < 2; i++) {
		const run = await busyWork(page, n);
		if (run.ms < best.ms) best = run;
	}
	return best;
}

async function fit(page: Page) {
	// "Fit" also matches Svelte Flow Controls' "Fit View" button without `exact`.
	await page.getByRole('button', { name: 'Fit', exact: true }).click();
	await settled(page);
}

test('50 nodes, 3 concurrent streams, continuous pan: p95 ≤ 20 ms at 4× CPU', async ({ page, signIn }) => {
	await signIn({ nodes: 50 });
	await page.goto('/canvas');
	await expect(page.locator('article[data-node-id]').first()).toBeVisible();
	await page.getByRole('button', { name: 'Tidy' }).click();
	await fit(page);

	const target = page.getByTestId('composer-target');
	const streaming: string[] = [];
	for (const q of [0.2, 0.5, 0.8]) {
		// Sending moves the viewport (auto-follow), so re-frame before every pick. The canvas renders only
		// the cards on screen, so pick among those whose Branch button a real mouse can reach — never one
		// of the cards already streaming.
		await fit(page);
		const reachable = await page.locator('article[data-node-id]').evaluateAll((els) =>
			els.flatMap((e) => {
				const b = e.querySelector('button[aria-label="Branch"]')!.getBoundingClientRect();
				const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
				return hit && e.contains(hit) ? [e.getAttribute('data-node-id')!] : [];
			})
		);
		const candidates = reachable.filter((id) => !streaming.includes(id));
		const id = candidates[Math.floor(candidates.length * q)];
		await page.locator(`article[data-node-id="${id}"] button[aria-label="Branch"]`).click();
		await expect(target).toHaveAttribute('data-target-id', id);
		await page.getByLabel('Message').fill('[slow][long] concurrent');
		await page.getByLabel('Message').press('Enter');
		// Sending points the composer at the new node, whichever order Svelte Flow renders the cards in.
		await expect(target).not.toHaveAttribute('data-target-id', id);
		const child = (await target.getAttribute('data-target-id'))!;
		streaming.push(child);
		await expect(page.locator(`article[data-node-id="${child}"]`)).toContainText('Echo:', { timeout: 10_000 });
	}
	await fit(page);

	// Every stream is still running: 600 words at 60 ms a token is far longer than this test.
	for (const id of streaming) {
		await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'streaming');
	}

	// Canary: the frame samples are capped by vsync, so they cannot show that throttling took effect.
	// Time the same fixed work before and after enabling it.
	const calibrated = await busyWork(page);
	const baseline = await fastest(page, calibrated.n);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	const throttled = await fastest(page, calibrated.n);
	expect(throttled.ms / baseline.ms, `CPU throttling must be in effect (${baseline.ms} ms -> ${throttled.ms} ms)`).toBeGreaterThanOrEqual(2.5);

	const nodePosition = (id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`).evaluate((el) => (el as HTMLElement).style.transform);
	const positionsBefore = await Promise.all(streaming.map(nodePosition));
	const viewportBefore = await viewport(page);
	const start = await emptyCanvasPoint(page);

	const measuring = page.evaluate(
		({ ms, ids }) =>
			new Promise<Sample>((resolve) => {
				const deltas: number[] = [];
				const longs: number[] = [];
				const mutated = new Set<string>();
				const po = new PerformanceObserver((l) => longs.push(...l.getEntries().map((e) => e.duration)));
				po.observe({ type: 'longtask' });
				const mo = new MutationObserver((records) => {
					for (const r of records) {
						const el = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
						const card = el?.closest('[data-node-id]') as HTMLElement | null;
						if (card && ids.includes(card.dataset.nodeId!)) mutated.add(card.dataset.nodeId!);
					}
				});
				mo.observe(document.querySelector('.svelte-flow__nodes')!, { subtree: true, childList: true, characterData: true });
				let last = performance.now();
				const end = last + ms;
				const tick = (t: number) => {
					deltas.push(t - last);
					last = t;
					if (t < end) return requestAnimationFrame(tick);
					po.disconnect();
					mo.disconnect();
					deltas.sort((a, b) => a - b);
					const at = (q: number) => Math.round(deltas[Math.floor(deltas.length * q)] * 10) / 10;
					resolve({ frames: deltas.length, p50: at(0.5), p95: at(0.95), max: Math.round(deltas.at(-1)! * 10) / 10, longTasks: longs.length, cardsMutated: mutated.size });
				};
				requestAnimationFrame(tick);
			}),
		{ ms: WINDOW_MS, ids: streaming }
	);

	// Pan from a bare-pane point, and keep the mouse moving until the sample window closes, so that every
	// measured frame is a frame of the pan.
	let done = false;
	// Stop panning when the window closes, however it closes. The rejection is not swallowed: it is
	// surfaced by `await measuring` below, and this chain has its own handler so it cannot go unhandled.
	const stop = () => {
		done = true;
	};
	void measuring.then(stop, stop);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	try {
		for (let i = 0; !done; i++) {
			await page.mouse.move(start.x + Math.sin(i / 8) * 90, start.y + Math.cos(i / 11) * 50);
			await page.waitForTimeout(16);
		}
	} finally {
		await page.mouse.up();
	}

	const sample = await measuring;
	console.log(JSON.stringify({ ...sample, canaryMs: { baseline: Math.round(baseline.ms * 10) / 10, throttled: Math.round(throttled.ms * 10) / 10 } }));

	// It was a viewport pan, not a node drag.
	expect(await viewport(page), 'the viewport must have panned').not.toEqual(viewportBefore);
	expect(await Promise.all(streaming.map(nodePosition)), 'no node may have been dragged').toEqual(positionsBefore);
	expect(sample.cardsMutated, 'all three streaming cards must be on screen and updating').toBeGreaterThanOrEqual(3);
	expect(sample.p95).toBeLessThanOrEqual(20);
});
