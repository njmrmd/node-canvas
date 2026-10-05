import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const cards = (page: Page) => page.locator('article[data-node-id]');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(page: Page, prompt: string, wait = true) {
	const target = page.getByTestId('composer-target');
	const previous = await target.getAttribute('data-target-id');
	await page.getByLabel('Message').fill(prompt);
	await page.getByLabel('Message').press('Enter');
	// Sending always points the composer at the new node. Counting or picking cards from the DOM would
	// not do: Svelte Flow renders only the cards in view, in its own order (a card that scrolls out and
	// back in moves to the end), so the rendered cards are not the list of nodes.
	await expect(target).not.toHaveAttribute('data-target-id', previous ?? '');
	const id = (await target.getAttribute('data-target-id'))!;
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toBeVisible();
	if (wait) await expect(card).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
	return id;
}

async function viewport(page: Page) {
	// DOMMatrixReadOnly is a browser global, so the parse has to run inside the page.
	return page.locator('.svelte-flow__viewport').evaluate((el) => {
		const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
		return { x: Math.round(m.e), y: Math.round(m.f), zoom: Math.round(m.a * 1000) / 1000 };
	});
}

/** Resolves once the viewport has stopped moving (the follow animation that frames a new card). */
async function settled(page: Page) {
	let last = JSON.stringify(await viewport(page));
	for (let stable = 0; stable < 3; ) {
		await sleep(150);
		const now = JSON.stringify(await viewport(page));
		stable = now === last ? stable + 1 : 0;
		last = now;
	}
}

async function emptyCanvasPoint(page: Page) {
	const point = await page.evaluate(() => {
		const pane = document.querySelector('.svelte-flow__pane')!;
		const r = pane.getBoundingClientRect();
		for (let y = r.top + 60; y < r.bottom - 60; y += 29)
			for (let x = r.left + 60; x < r.right - 260; x += 41)
				if (document.elementFromPoint(x, y)?.classList.contains('svelte-flow__pane')) return { x, y };
		return null;
	});
	if (!point) throw new Error('no empty canvas point on screen');
	return point;
}

async function fit(page: Page) {
	await page.getByRole('button', { name: 'Fit', exact: true }).click();
	await sleep(400);
}

test('Branch binds the composer to the chosen node, every time', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const chain: string[] = [];
	for (const n of ['one', 'two', 'three', 'four']) chain.push(await send(page, `Chain ${n}`));
	for (let run = 0; run < 20; run++) {
		await fit(page);
		// Fit stops at the minimum zoom, so once the canvas holds ~20 cards some stay off screen:
		// pick among the cards whose Branch button a real mouse can actually reach.
		const ids = await cards(page).evaluateAll((els) =>
			els.flatMap((e) => {
				const b = e.querySelector('button[aria-label="Branch"]')!.getBoundingClientRect();
				const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
				return hit && e.contains(hit) ? [e.getAttribute('data-node-id')!] : [];
			})
		);
		const pick = run % 2 === 0 ? chain[1] : ids[(run * 7) % (ids.length - 1)];
		await page.locator(`article[data-node-id="${pick}"] button[aria-label="Branch"]`).click();
		await expect(page.getByTestId('composer-target'), `run ${run}: after Branch`).toHaveAttribute('data-target-id', pick);
		const p = await emptyCanvasPoint(page);
		await page.mouse.click(p.x, p.y);
		await expect(page.getByTestId('composer-target'), `run ${run}: after canvas click`).toHaveAttribute('data-target-id', pick);
		const child = await send(page, `Fork ${run}`);
		await expect(page.locator(`article[data-node-id="${child}"]`), `run ${run}: parent`).toHaveAttribute('data-parent-id', pick);
	}
});

test('wheel over a card body scrolls it; over the canvas it zooms', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[long] long answer');
	const body = page.locator(`article[data-node-id="${id}"] [data-testid="card-body"]`);
	const before = await viewport(page);
	await body.hover();
	await page.mouse.wheel(0, 400);
	await sleep(300);
	expect(await body.evaluate((b) => b.scrollTop)).toBeGreaterThan(100);
	expect(await viewport(page)).toEqual(before);
	const p = await emptyCanvasPoint(page);
	await page.mouse.move(p.x, p.y);
	await page.mouse.wheel(0, 400);
	await sleep(300);
	expect((await viewport(page)).zoom).toBeLessThan(before.zoom);
});

test('a new node is framed and followed while it streams, until the user pans', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] follow me', false);
	const inView = () =>
		page.evaluate((id) => {
			const card = document.querySelector(`[data-node-id="${id}"]`)!.getBoundingClientRect();
			const flow = document.querySelector('.svelte-flow')!.getBoundingClientRect();
			return card.top >= flow.top && card.bottom <= flow.bottom + 1;
		}, id);
	await sleep(800);
	expect(await inView()).toBe(true);
	await sleep(3000);
	expect(await inView()).toBe(true);
	const p = await emptyCanvasPoint(page);
	await page.mouse.move(p.x, p.y);
	await page.mouse.down();
	await page.mouse.move(p.x + 60, p.y + 120, { steps: 8 });
	await page.mouse.up();
	const afterPan = await viewport(page);
	await sleep(1500);
	expect(await viewport(page)).toEqual(afterPan);
});

test('dragging a card moves it and the position survives a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'drag me');
	// Measure the title only after the framing animation ends; a mouse-down on a card that is still
	// sliding lands on the empty pane and pans the canvas instead, which moves the card on screen too.
	await settled(page);
	const title = page.locator(`article[data-node-id="${id}"] .prompt`);
	const box = (await title.boundingBox())!;
	const before = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	await page.mouse.move(box.x + 20, box.y + box.height / 2);
	await page.mouse.down();
	// Real-mouse spacing: Svelte Flow skips the move that crosses its drag threshold.
	await page.mouse.move(box.x + 170, box.y + box.height / 2 + 90, { steps: 60 });
	await page.mouse.up();
	const moved = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	expect(moved.x - before.x).toBeGreaterThan(130);
	await expect.poll(async () => (await page.request.get('/canvas/__data.json')).text()).toContain('"manual"');
	await page.reload();
	const reloaded = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(4);
});
