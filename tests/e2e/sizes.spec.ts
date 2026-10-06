import { expect, test } from './fixtures';
import { fit, savedNodesText, send, settled, viewport } from './helpers';

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
