import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export const cards = (page: Page) => page.locator('article[data-node-id]');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends from the composer and returns the new card's id. Sending always points the composer at the new
 * node; counting or picking cards from the DOM would not do, because Svelte Flow renders only the cards
 * in view, in its own order.
 */
export async function send(page: Page, prompt: string, { wait = true }: { wait?: boolean } = {}): Promise<string> {
	const target = page.getByTestId('composer-target');
	const previous = await target.getAttribute('data-target-id');
	await page.getByLabel('Message').fill(prompt);
	await page.getByLabel('Message').press('Enter');
	await expect(target).not.toHaveAttribute('data-target-id', previous ?? '');
	const id = (await target.getAttribute('data-target-id'))!;
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toBeVisible();
	if (wait) await expect(card).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
	return id;
}

/** Every saved node as the canvas load fetches them, page by page, as JSON text — for `toContain` waits. */
export async function savedNodesText(page: Page): Promise<string> {
	const parts: string[] = [];
	let after: string | null = null;
	do {
		const res = await page.request.get(after === null ? '/api/nodes' : `/api/nodes?after=${encodeURIComponent(after)}`);
		const body = (await res.json()) as { nodes: unknown[]; next: string | null };
		parts.push(JSON.stringify(body.nodes));
		after = body.next;
	} while (after !== null);
	return parts.join('\n');
}

export async function viewport(page: Page) {
	// DOMMatrixReadOnly is a browser global, so the parse has to run inside the page.
	return page.locator('.svelte-flow__viewport').evaluate((el) => {
		const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
		return { x: Math.round(m.e), y: Math.round(m.f), zoom: Math.round(m.a * 1000) / 1000 };
	});
}

/** Resolves once the viewport has stopped moving (the follow animation that frames a new card). */
export async function settled(page: Page) {
	let last = JSON.stringify(await viewport(page));
	for (let stable = 0; stable < 3; ) {
		await sleep(150);
		const now = JSON.stringify(await viewport(page));
		stable = now === last ? stable + 1 : 0;
		last = now;
	}
}

export async function emptyCanvasPoint(page: Page) {
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

export async function fit(page: Page) {
	await page.getByRole('button', { name: 'Fit', exact: true }).click();
	await sleep(400);
}
