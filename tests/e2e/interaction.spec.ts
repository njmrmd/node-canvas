import { expect, test } from './fixtures';
import { cards, emptyCanvasPoint, fit, savedNodesText, send, settled, sleep, viewport } from './helpers';

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
	const id = await send(page, '[slow][long] follow me', { wait: false });
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
	await expect.poll(() => savedNodesText(page)).toContain('"manual"');
	await page.reload();
	const reloaded = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(4);
});

test('dragging a streaming card stops auto-follow, so the viewport stays put', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] drag me while I stream', { wait: false });
	await settled(page);
	const before = await viewport(page);
	// [slow][long] streams for ~30 s, so it is still growing through the drag and the wait below.
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'streaming');
	const title = page.locator(`article[data-node-id="${id}"] .prompt`);
	const box = (await title.boundingBox())!;
	const pane = (await page.locator('.svelte-flow__pane').boundingBox())!;
	await page.mouse.move(box.x + 20, box.y + box.height / 2);
	await page.mouse.down();
	// Down until the growing card's bottom is off screen, so following would chase it, but the pointer
	// stays clear of the pane's 40 px auto-pan band: any viewport move is the follow, not the drag.
	await page.mouse.move(box.x + 20, pane.y + pane.height - 100, { steps: 60 });
	await page.mouse.up();
	await sleep(2000);
	expect(await viewport(page)).toEqual(before);
});
