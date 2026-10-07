import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fit, savedNodesText, send, settled, viewport } from './helpers';

/** From one card's bottom to another's top, in flow units: negative when the lower one sits on the upper one. */
async function flowGap(page: Page, upper: string, lower: string): Promise<number> {
	const { zoom } = await viewport(page);
	const u = await page.locator(`.svelte-flow__node[data-id="${upper}"]`).boundingBox();
	const l = await page.locator(`.svelte-flow__node[data-id="${lower}"]`).boundingBox();
	return u && l ? (l.y - (u.y + u.height)) / zoom : Number.NEGATIVE_INFINITY; // not drawn yet: poll again
}

test('dragging the corner resizes a card, and the size survives a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'resize me');
	await settled(page);
	const card = page.locator(`article[data-node-id="${id}"]`);
	const before = (await card.boundingBox())!;
	await card.hover();
	const handle = (await card.locator('.svelte-flow__resize-control').boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2 + 60, { steps: 20 });
	await page.mouse.up();
	const after = (await card.boundingBox())!;
	expect(after.width - before.width).toBeGreaterThan(50);
	await expect.poll(() => savedNodesText(page)).toMatch(/"width":\d/);
	await page.reload();
	const reloaded = (await page.locator(`article[data-node-id="${id}"]`).boundingBox())!;
	expect(Math.abs(reloaded.width - after.width)).toBeLessThan(4);
});

test("collapsing a card's body leaves one line; expanding brings the reply back", async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'fold me');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await card.getByRole('button', { name: 'Collapse to one line' }).click();
	await expect(card.getByTestId('card-oneline')).toHaveText(/^Echo: fold me\./);
	await expect(card.getByTestId('card-body')).toHaveCount(0);
	expect((await card.boundingBox())!.height).toBeLessThan(110); // one line, not the old app's 120 px floor
	await card.getByRole('button', { name: 'Show full reply' }).click();
	await expect(card.getByTestId('card-body')).toBeVisible();
});

test('collapsing a subtree hides the cards below and says how many', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'top');
	const b = await send(page, 'middle');
	const c = await send(page, 'bottom');
	const top = page.locator(`article[data-node-id="${a}"]`);
	await top.getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toHaveCount(0);
	await expect(page.locator(`article[data-node-id="${c}"]`)).toHaveCount(0);
	await expect(top.getByRole('button', { name: '2 hidden' })).toBeVisible();
	await expect.poll(() => savedNodesText(page)).toContain('"collapsed":true');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toHaveCount(0);
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: '2 hidden' }).click();
	await fit(page);
	await expect(page.locator(`article[data-node-id="${c}"]`)).toBeVisible();
});

test('sending to a card hidden by a collapse expands it, so the reply is drawn', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'outer');
	const b = await send(page, 'inner'); // the composer now replies to b
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toHaveCount(0);
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', b);
	const c = await send(page, 'reply to the hidden card');
	await expect(page.locator(`article[data-node-id="${c}"]`)).toHaveAttribute('data-parent-id', b);
	await expect(page.locator(`article[data-node-id="${b}"]`)).toBeVisible();
});

test('Undo under a parent collapsed since brings the branch back in view', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'parent of two');
	const first = await send(page, 'first reply');
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Branch' }).click();
	const second = await send(page, 'second reply');
	await page.locator(`article[data-node-id="${first}"]`).getByRole('button', { name: 'Delete' }).click();
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${second}"]`)).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await fit(page);
	await expect(page.locator(`article[data-node-id="${first}"]`)).toBeVisible();
	await expect(page.locator(`article[data-node-id="${second}"]`)).toBeVisible();
});

test('a click on the resize corner without a drag leaves the card unsized', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'click the corner');
	await settled(page);
	const card = page.locator(`article[data-node-id="${id}"]`);
	await card.hover();
	const handle = (await card.locator('.svelte-flow__resize-control').boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.up();
	await page.waitForTimeout(300);
	expect(await card.evaluate((el) => el.classList.contains('sized'))).toBe(false); // read once: a retrying check could pass before the click lands
});

test('sending to a reply hidden since a Tidy lays it out under its parent again, as the chip would', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'parent card');
	const reply = await send(page, 'its reply'); // the composer now replies to it
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${reply}"]`)).toHaveCount(0);
	await page.getByRole('button', { name: 'Tidy', exact: true }).click(); // moves the parent; the hidden reply keeps its place
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', reply);
	await send(page, 'a reply to the hidden card');
	await fit(page);
	const { zoom } = await viewport(page);
	const p = (await page.locator(`.svelte-flow__node[data-id="${parent}"]`).boundingBox())!;
	const r = (await page.locator(`.svelte-flow__node[data-id="${reply}"]`).boundingBox())!;
	expect(Math.abs(r.x + r.width / 2 - (p.x + p.width / 2)) / zoom).toBeLessThan(40); // centred under it, in flow units
	expect((r.y - (p.y + p.height)) / zoom).toBeGreaterThan(0); // and below it
});

test("reopening a collapsed chain lays a tall card's reply below it, not on top of it", async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const top = await send(page, 'top');
	const middle = await send(page, '[long] a tall middle card');
	const bottom = await send(page, 'bottom');
	await fit(page); // once the tall card is framed, the top one is off screen
	const topCard = page.locator(`article[data-node-id="${top}"]`);
	await topCard.getByRole('button', { name: 'Collapse', exact: true }).click();
	await topCard.getByRole('button', { name: '2 hidden' }).click();
	await fit(page);
	await expect(page.locator(`article[data-node-id="${bottom}"]`)).toBeVisible();
	const { zoom } = await viewport(page);
	const m = (await page.locator(`.svelte-flow__node[data-id="${middle}"]`).boundingBox())!;
	const b = (await page.locator(`.svelte-flow__node[data-id="${bottom}"]`).boundingBox())!;
	expect((b.y - (m.y + m.height)) / zoom).toBeGreaterThanOrEqual(0); // the bottom card's top, in flow units, at or below the middle card's bottom
});

test('a streaming card resized to the minimum width keeps its Delete button inside it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.route('**/api/chat', () => {}); // never answered: the card stays on "Thinking", its widest header
	const id = await send(page, 'narrow while thinking', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card.locator('.status')).toHaveText('Thinking');
	await settled(page);
	await card.hover();
	const handle = (await card.locator('.svelte-flow__resize-control').boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 - 300, handle.y + handle.height / 2, { steps: 20 }); // past the 240 px minimum
	await page.mouse.up();
	await expect(card).toHaveCSS('width', '240px');
	await expect(card).toHaveCSS('height', '120px');
	const box = (await card.boundingBox())!;
	const del = (await card.getByRole('button', { name: 'Delete' }).boundingBox())!;
	expect(del.x).toBeGreaterThanOrEqual(box.x);
	expect(del.y).toBeGreaterThanOrEqual(box.y);
	expect(del.x + del.width).toBeLessThanOrEqual(box.x + box.width);
	expect(del.y + del.height).toBeLessThanOrEqual(box.y + box.height);
});

test('a send to a hidden card that was the newest lays the reply below it, not on top of it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'parent');
	const tall = await send(page, '[long] tall newest'); // the composer now replies to it
	await fit(page);
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${tall}"]`)).toHaveCount(0);
	const next = await send(page, 'below the tall card');
	await fit(page);
	await expect.poll(() => flowGap(page, tall, next)).toBeGreaterThanOrEqual(0);
});

test("reopening after a reload lays a tall card's reply below it, not on top of it", async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const top = await send(page, 'top');
	const middle = await send(page, '[long] a tall middle card');
	const bottom = await send(page, 'bottom');
	await fit(page);
	await page.locator(`article[data-node-id="${top}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect.poll(() => savedNodesText(page)).toContain('"collapsed":true');
	await page.reload(); // the cards under the collapse are never drawn in this session
	await page.locator(`article[data-node-id="${top}"]`).getByRole('button', { name: '2 hidden' }).click();
	await fit(page);
	await expect.poll(() => flowGap(page, middle, bottom)).toBeGreaterThanOrEqual(0);
});

test("Undo under a parent collapsed since lays the tall card's reply below it, not on top of it", async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'parent');
	const tall = await send(page, '[long] a tall reply');
	const under = await send(page, 'under the tall reply');
	await fit(page);
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Branch' }).click();
	const sibling = await send(page, 'a sibling');
	await fit(page);
	await page.locator(`article[data-node-id="${tall}"]`).getByRole('button', { name: 'Delete' }).click();
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${sibling}"]`)).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await fit(page);
	await expect.poll(() => flowGap(page, tall, under)).toBeGreaterThanOrEqual(0);
});

test('a drag that ends where it began still saves the size it gave the card', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'there and back');
	await settled(page);
	const card = page.locator(`article[data-node-id="${id}"]`);
	await card.hover();
	const handle = (await card.locator('.svelte-flow__resize-control').boundingBox())!;
	const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 40, y, { steps: 8 });
	await page.mouse.move(x, y, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => savedNodesText(page)).toMatch(/"width":\d/);
});
