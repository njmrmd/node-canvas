import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

type Sample = { frames: number; p50: number; p95: number; max: number; longTasks: number; cardsMutated: number };

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

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

	const measuring = page.evaluate(
		(ms) =>
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
						if (card) mutated.add(card.dataset.nodeId!);
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
		5000
	);

	const box = (await page.locator('.svelte-flow__pane').boundingBox())!;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	for (let i = 0; i < 120; i++) {
		await page.mouse.move(cx + Math.sin(i / 8) * 90, cy + Math.cos(i / 11) * 50);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();

	const sample = await measuring;
	console.log(JSON.stringify(sample));
	expect(sample.cardsMutated, 'the streaming cards must be on screen').toBeGreaterThanOrEqual(3);
	expect(sample.p95).toBeLessThanOrEqual(20);
});
