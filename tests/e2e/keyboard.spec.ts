import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { cards, emptyCanvasPoint, fit, savedNodesText, send, settled, viewport } from './helpers';

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-node-id') ?? null);
const card = (page: Page, id: string) => page.locator(`article[data-node-id="${id}"]`);

test('arrows, Home and End move focus along the tree', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const r = await send(page, 'root');
	const a = await send(page, 'first reply');
	const b = await send(page, 'reply to the reply');
	await fit(page);
	await card(page, r).getByRole('button', { name: 'Branch' }).click();
	const s = await send(page, 'second reply');
	await page.getByLabel('Message').press('Escape'); // back to the card the composer replies to
	await expect.poll(() => focused(page)).toBe(s);
	for (const [key, expected] of [
		['Home', r],
		['ArrowDown', a],
		['ArrowRight', s],
		['ArrowLeft', a],
		['ArrowDown', b],
		['ArrowUp', a],
		['End', s]
	] as const) {
		await page.keyboard.press(key);
		await expect.poll(() => focused(page), key).toBe(expected);
	}
});

test('End reaches an off-screen card and focuses it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'top');
	await send(page, 'middle');
	const last = await send(page, 'bottom');
	await page.getByLabel('Message').blur();
	for (let i = 0; i < 2; i++) {
		const p = await emptyCanvasPoint(page);
		await page.mouse.move(p.x, p.y);
		await page.mouse.down();
		await page.mouse.move(p.x + 600, p.y + 500, { steps: 10 });
		await page.mouse.up();
	}
	await expect(cards(page)).toHaveCount(0);
	await page.keyboard.press('End');
	await expect.poll(() => focused(page)).toBe(last);
	await expect(card(page, last)).toBeVisible();
});

test('Enter binds the composer to the focused card; a click focuses a card without changing the target', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const root = await send(page, 'bind root');
	const leaf = await send(page, 'bind leaf');
	await page.getByLabel('Message').press('Escape');
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => focused(page)).toBe(root);
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', root);
	await expect(page.getByLabel('Message')).toBeFocused();
	await card(page, leaf).getByTestId('card-body').click();
	await expect.poll(() => focused(page)).toBe(leaf);
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', root);
});

test('Alt+arrows nudge the focused card and Cmd/Ctrl+Alt+arrows resize it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'nudge me');
	await settled(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	const box = async () => (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	const { zoom } = await viewport(page);
	const before = await box();
	await page.keyboard.press('Alt+ArrowRight');
	await page.keyboard.press('Shift+Alt+ArrowDown');
	await expect.poll(async () => Math.round(((await box()).x - before.x) / zoom)).toBe(16);
	await expect.poll(async () => Math.round(((await box()).y - before.y) / zoom)).toBe(64);
	await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');
	await expect.poll(async () => Math.round(((await box()).width - before.width) / zoom)).toBe(8);
	await expect.poll(() => savedNodesText(page)).toContain('"manual"');
});

test('Delete removes the focused card and Cmd/Ctrl+Z brings it back, focused', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const keep = await send(page, 'keep me');
	const drop = await send(page, 'drop me');
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(drop);
	await page.keyboard.press('Delete');
	await expect(card(page, drop)).toHaveCount(0);
	await expect.poll(() => focused(page)).toBe(keep); // focus moves to the parent
	await page.keyboard.press('ControlOrMeta+z');
	await expect(card(page, drop)).toBeVisible();
	await expect.poll(() => focused(page)).toBe(drop); // and comes back with the card
});

test('B, R, C and M act on the focused card', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const root = await send(page, 'root');
	const leaf = await send(page, 'leaf');
	await page.getByLabel('Message').press('Escape');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('b');
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', root);
	await expect(page.getByLabel('Message')).toBeFocused();
	await page.getByLabel('Message').press('Escape'); // focus the root again
	await page.keyboard.press('m');
	await expect(card(page, root).getByTestId('card-oneline')).toBeVisible();
	await page.keyboard.press('m');
	await page.keyboard.press('c');
	await expect(card(page, leaf)).toHaveCount(0);
	await page.keyboard.press('c');
	await expect(card(page, leaf)).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focused(page)).toBe(leaf);
	await page.keyboard.press('r');
	const target = page.getByTestId('composer-target');
	await expect(target).not.toHaveAttribute('data-target-id', root);
	const sibling = card(page, (await target.getAttribute('data-target-id'))!);
	await expect(sibling).toHaveAttribute('data-parent-id', root);
	await expect(sibling.locator('.prompt')).toHaveText('leaf');
});

test('Esc stops the focused card while it streams', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] stop with esc', { wait: false });
	await expect(card(page, id)).toContainText('Echo: stop with esc.');
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	await page.keyboard.press('Escape');
	await expect(card(page, id)).toHaveAttribute('data-status', 'interrupted');
});

test('zoom keys, and the 100% button', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'zoom around me');
	await settled(page);
	await page.getByLabel('Message').blur();
	await page.keyboard.press('1');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
	await page.keyboard.press('+');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1.2);
	await page.keyboard.press('-');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
	await page.keyboard.press('-');
	await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(0.833, 2);
	const reset = page.getByRole('button', { name: 'Zoom to 100%' });
	expect(await reset.evaluate((b) => b.scrollWidth <= b.clientWidth), 'the 100% label fits its button').toBe(true);
	await reset.click();
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
	await page.keyboard.press('0'); // fit: one card fits at the maximum zoom
	await expect.poll(async () => (await viewport(page)).zoom).not.toBe(1);
});

test('L tidies, F toggles the focus path, T opens the linear view, ? opens the sheet', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'shortcut target');
	await page.getByLabel('Message').blur();
	await page.keyboard.press('t');
	await expect(page.getByRole('region', { name: 'Linear view' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('region', { name: 'Linear view' })).toHaveCount(0);
	await page.keyboard.press('f');
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await page.keyboard.press('?');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
	// Hidden is not closed: Chrome fires the dialog's close event, which ends the sheet, up to a frame after hiding it.
	await expect(page.locator('dialog')).toHaveCount(0);
	await page.keyboard.press('l'); // Tidy puts the only card at the layout origin
	await expect.poll(() => savedNodesText(page)).toContain('"x":0,"y":0');
});

test('typing T, F, 0 and Backspace in the composer only edits the draft', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'typed target');
	await settled(page);
	const before = await viewport(page);
	const field = page.getByLabel('Message');
	await field.click();
	await page.keyboard.type('tf0l');
	await page.keyboard.press('Backspace');
	await expect(field).toHaveValue('tf0');
	await page.getByLabel('Model').focus();
	await page.keyboard.press('t');
	await expect(page.getByRole('region', { name: 'Linear view' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'true');
	expect(await viewport(page)).toEqual(before);
	await expect(card(page, id)).toBeVisible();
});

test('holding Delete deletes one card, not each parent in turn', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'hold parent');
	const child = await send(page, 'hold child');
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(child);
	await page.keyboard.down('Delete');
	await expect(card(page, child)).toHaveCount(0);
	await expect.poll(() => focused(page)).toBe(parent);
	await page.keyboard.down('Delete'); // what the OS sends while the key stays down: the same keydown again, marked as a repeat
	await page.keyboard.up('Delete');
	await page.waitForTimeout(300); // a repeat that deleted would have removed the parent by now
	await expect(card(page, parent)).toHaveCount(1);
});

test('keys pressed in the linear view stay in it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'read me in the panel');
	await page.getByLabel('Message').blur();
	await page.keyboard.press('t');
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel).toBeFocused();
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowUp');
	await expect(panel).toBeFocused();
	await page.keyboard.press('Tab'); // to the panel's own button
	const copyAll = panel.getByRole('button', { name: 'Copy all' });
	await expect(copyAll).toBeFocused();
	const focusPath = page.getByRole('button', { name: 'Focus path' });
	const pressed = (await focusPath.getAttribute('aria-pressed'))!;
	await page.keyboard.press('End');
	await page.keyboard.press('f');
	await expect(copyAll).toBeFocused();
	await expect(focusPath).toHaveAttribute('aria-pressed', pressed);
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
});

test('Esc in the composer, with its target hidden, focuses the collapsed card that hides it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'hide my reply');
	const child = await send(page, 'the hidden reply');
	await settled(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(child);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => focused(page)).toBe(parent);
	await page.keyboard.press('c');
	await expect(card(page, child)).toHaveCount(0);
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', child);
	await page.getByLabel('Message').click();
	const before = await viewport(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(parent);
	expect(await viewport(page)).toEqual(before);
});

test('zoom anchors on the focused card while it is on screen, and on the canvas centre once it is not', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'anchor the zoom');
	await settled(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	const centre = async () => {
		const b = (await card(page, id).boundingBox())!;
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	};
	const before = await centre();
	await page.keyboard.press('+');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1.2);
	await settled(page);
	const after = await centre();
	expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
	for (let i = 0; i < 2; i++) {
		const p = await emptyCanvasPoint(page);
		await page.mouse.move(p.x, p.y);
		await page.mouse.down();
		await page.mouse.move(p.x + 600, p.y + 500, { steps: 10 });
		await page.mouse.up();
	}
	await expect(cards(page)).toHaveCount(0); // still the focused card, but out of view
	const area = (await page.locator('.flow').boundingBox())!;
	const mid = { x: area.width / 2, y: area.height / 2 };
	const from = await viewport(page);
	await page.keyboard.press('+');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1.44);
	await settled(page);
	const to = await viewport(page);
	// The canvas point that was under the container's centre is still there.
	const x = (mid.x - from.x) / from.zoom;
	const y = (mid.y - from.y) / from.zoom;
	expect(Math.abs(x * to.zoom + to.x - mid.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(y * to.zoom + to.y - mid.y)).toBeLessThanOrEqual(2);
});

test('held Alt+arrows keep the card on screen and focused', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'push me to the edge');
	await settled(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	for (let i = 0; i < 15; i++) await page.keyboard.press('Shift+Alt+ArrowLeft');
	await settled(page);
	await expect.poll(() => focused(page)).toBe(id);
	const box = (await card(page, id).boundingBox())!;
	const area = (await page.locator('.flow').boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(area.x);
	expect(box.y).toBeGreaterThanOrEqual(area.y);
	expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
	expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
});

test('a held Enter on a card binds the composer and sends nothing', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'hold Enter on me');
	const field = page.getByLabel('Message');
	await field.fill('a draft I am still writing');
	await field.press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	await page.keyboard.down('Enter');
	await expect(field).toBeFocused();
	await page.keyboard.down('Enter'); // the OS's auto-repeat, which now lands in the composer
	await page.keyboard.up('Enter');
	await expect(field).toHaveValue('a draft I am still writing');
	await expect(cards(page)).toHaveCount(1);
});

test('keyboard-resizing a card taller than the view keeps its moving edge in view, and a nudge barely moves the view', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'grow me past the view');
	await settled(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	const area = (await page.locator('.flow').boundingBox())!;
	const box = async () => (await card(page, id).boundingBox())!;
	for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+ControlOrMeta+Alt+ArrowDown'); // up to the 900 px clamp
	await settled(page);
	expect((await box()).height).toBeGreaterThan(area.height);
	for (const key of ['ControlOrMeta+Alt+ArrowDown', 'ControlOrMeta+Alt+ArrowUp']) {
		const before = await viewport(page);
		await page.keyboard.press(key);
		await settled(page);
		const b = await box();
		expect(b.y + b.height, `${key}: the bottom edge is in view`).toBeLessThanOrEqual(area.y + area.height);
		expect(b.y, `${key}: the view did not jump to the card's top`).toBeLessThan(area.y);
		expect((await viewport(page)).y, `${key}: the view did not move`).toBe(before.y);
	}
	// Its bottom still in view, a 16 px nudge up moves the card against a view that holds (at most by the nudge).
	const before = await viewport(page);
	await page.keyboard.press('Alt+ArrowUp');
	await settled(page);
	expect(Math.abs((await viewport(page)).y - before.y), 'Alt+ArrowUp moves the view no more than the nudge').toBeLessThanOrEqual(16 * before.zoom + 2);
	await expect.poll(() => focused(page)).toBe(id);
});

test('with the linear view open, arrowing to a card under it brings the card out beside it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const left = await send(page, 'the left root');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const right = await send(page, 'the right root'); // a new root is placed to the right of the others
	await fit(page);
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel).toBeVisible();
	const p = (await panel.boundingBox())!;
	const before = (await card(page, right).boundingBox())!;
	expect(before.x + before.width / 2, 'the right root starts under the panel').toBeGreaterThan(p.x);
	await card(page, left).getByTestId('card-body').click();
	await expect.poll(() => focused(page)).toBe(left);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => focused(page)).toBe(right);
	await settled(page);
	const after = (await card(page, right).boundingBox())!;
	expect(after.x + after.width).toBeLessThanOrEqual(p.x);
});

test('nudges keep the card clear of the open linear view', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'stay beside the panel');
	await settled(page);
	await page.getByLabel('Message').blur();
	await page.keyboard.press('t');
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel).toBeVisible();
	await page.getByLabel('Message').click();
	await page.getByLabel('Message').press('Escape'); // back to the card; the panel stays open
	await expect.poll(() => focused(page)).toBe(id);
	for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+Alt+ArrowRight');
	await settled(page);
	await expect.poll(() => focused(page)).toBe(id);
	const b = (await card(page, id).boundingBox())!;
	const p = (await panel.boundingBox())!;
	expect(b.x + b.width).toBeLessThanOrEqual(p.x);
});

test('with the linear view open, a streaming reply is framed in the middle of the part that shows', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'a parent beside the panel');
	await settled(page);
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel).toBeVisible();
	const id = await send(page, '[slow][long] a reply that keeps streaming', { wait: false });
	const area = (await page.locator('.flow').boundingBox())!;
	const p = (await panel.boundingBox())!;
	const offCentre = async () => {
		const b = (await card(page, id).boundingBox())!;
		return Math.abs(b.x + b.width / 2 - (area.x + (p.x - area.x) / 2));
	};
	await expect.poll(offCentre).toBeLessThanOrEqual(2);
	expect((await viewport(page)).zoom, 'the framing pan ran to its end').toBe(1);
});
