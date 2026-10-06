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

test('Delete removes the focused card and Cmd/Ctrl+Z brings it back', async ({ page, signIn }) => {
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
	await page.getByRole('button', { name: 'Zoom to 100%' }).click();
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
	await page.keyboard.press('Delete');
	await expect(card(page, child)).toHaveCount(0);
	await expect.poll(() => focused(page)).toBe(parent);
	// What the OS sends while the key stays down: the same keydown again, marked as a repeat.
	await page.evaluate(() =>
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', repeat: true, bubbles: true, cancelable: true }))
	);
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
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
});
