import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';
import { cards, savedNodesText, send } from './helpers';

test('deleting an ancestor of the target clears the composer, and Undo rebinds it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'parent card');
	const b = await send(page, 'child card');
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect(cards(page)).toHaveCount(0);
	// The status region is always mounted (and has no box of its own); the message inside it is what shows.
	await expect(page.getByRole('status').getByText('Node and 1 below it deleted.', { exact: true })).toBeVisible();
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', '');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator(`article[data-node-id="${a}"]`)).toBeVisible();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toBeVisible();
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', b);
});

test('Undo leaves the composer alone when the target was chosen again since the delete', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const target = page.getByTestId('composer-target');
	const a = await send(page, 'the card to branch from');
	const b = await send(page, 'the card to delete');
	await expect(target).toHaveAttribute('data-target-id', b);
	await page.locator(`article[data-node-id="${b}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect(target).toHaveAttribute('data-target-id', '');
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Branch' }).click();
	await expect(target).toHaveAttribute('data-target-id', a);
	await page.getByRole('button', { name: 'New conversation' }).click();
	await expect(target).toHaveAttribute('data-target-id', '');
	await page.getByRole('button', { name: 'Undo' }).click();
	// Undo is one synchronous store call, so once b is drawn again the target is what Undo left it.
	await expect(page.locator(`article[data-node-id="${b}"]`)).toBeVisible();
	await expect(target).toHaveAttribute('data-target-id', '');
});

test('a delete survives a reload, and so does its undo', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'delete me for good');
	await expect.poll(() => savedNodesText(page)).toContain('delete me for good');
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect.poll(() => savedNodesText(page)).not.toContain('delete me for good');
	await page.reload();
	await expect(page.getByText('Ask anything. Then take it three directions.')).toBeVisible();

	const b = await send(page, 'bring me back');
	await expect.poll(() => savedNodesText(page)).toContain('bring me back');
	await page.locator(`article[data-node-id="${b}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect.poll(() => savedNodesText(page)).not.toContain('bring me back');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => savedNodesText(page)).toContain('bring me back');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toContainText('Echo: bring me back.');
});

test('deleting a streaming branch stops it, and Undo brings it back as Stopped', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] keep going', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: keep going.');
	await card.getByRole('button', { name: 'Delete' }).click();
	await expect(card).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(card).toHaveAttribute('data-status', 'interrupted');
	await expect(card).toContainText('Echo: keep going.');
	await expect(card).toBeVisible(); // a re-added card is hidden until measured, and innerText reads nothing then
	const body = card.getByTestId('card-body');
	const text = await body.innerText();
	await page.waitForTimeout(800); // a stream left running would keep adding text
	expect(await body.innerText()).toBe(text);
	await expect.poll(() => savedNodesText(page)).toContain('"interrupted"');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'interrupted');
});

test('Retry sends the same prompt again into the same card', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[refuse] try again', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await resetAnthropic();
	await card.getByRole('button', { name: 'Retry' }).click();
	await expect.poll(async () => (await anthropicRequests()).length).toBe(1);
	await expect(card).toHaveAttribute('data-status', 'error'); // the fake refuses every time
	const [sent] = await anthropicRequests();
	expect((sent.body.messages as { content: string }[]).at(-1)?.content).toBe('[refuse] try again');
	await expect(cards(page)).toHaveCount(1);
});

test('Continue asks for the rest of a stopped reply in a new card below it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] continue me', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: continue me.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await expect(card).toHaveAttribute('data-status', 'interrupted');
	await resetAnthropic();
	await card.getByRole('button', { name: 'Continue' }).click();
	const target = page.getByTestId('composer-target');
	await expect(target).not.toHaveAttribute('data-target-id', id);
	const child = page.locator(`article[data-node-id="${await target.getAttribute('data-target-id')}"]`);
	await expect(child).toHaveAttribute('data-parent-id', id);
	await expect(child).toContainText('continued from above');
	await expect.poll(async () => (await anthropicRequests()).length).toBe(1);
	const messages = (await anthropicRequests())[0].body.messages as { role: string; content: string }[];
	expect(messages.at(-1)).toEqual({ role: 'user', content: 'Continue from where you left off.' });
	expect(messages.at(-2)?.role).toBe('assistant');
	expect(messages.at(-2)?.content).toMatch(/^Echo: continue me\./);
});

test('Regenerate asks the same prompt again in a new card beside it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const root = await send(page, 'root for regenerate');
	const id = await send(page, '[slow][long] say it again', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: say it again.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await card.getByRole('button', { name: 'Regenerate' }).click();
	const target = page.getByTestId('composer-target');
	await expect(target).not.toHaveAttribute('data-target-id', id);
	const sibling = page.locator(`article[data-node-id="${await target.getAttribute('data-target-id')}"]`);
	await expect(sibling).toHaveAttribute('data-parent-id', root);
	await expect(sibling.locator('.prompt')).toHaveText('[slow][long] say it again');
});

test('Retry on a card whose reply was just deleted ends that Undo, so no reply comes back under cleared text', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, '[midfail] part of an answer', { wait: false });
	const card = page.locator(`article[data-node-id="${parent}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	const child = await send(page, 'a reply to the partial answer');
	await page.locator(`article[data-node-id="${child}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
	await card.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('a double click on Continue makes one card, not two', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] once only', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: once only.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await card.getByRole('button', { name: 'Continue' }).dblclick();
	await expect(page.locator(`article[data-parent-id="${id}"]`)).toHaveCount(1);
});

test('deleting a card whose reply is still streaming stops it, and Undo brings both back', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const parent = await send(page, 'parent of a long reply');
	const child = await send(page, '[slow][long] still going below', { wait: false });
	const childCard = page.locator(`article[data-node-id="${child}"]`);
	await expect(childCard).toContainText('Echo: still going below.');
	await page.locator(`article[data-node-id="${parent}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect(childCard).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(childCard).toHaveAttribute('data-status', 'interrupted');
	await expect(childCard).toBeVisible();
	const body = childCard.getByTestId('card-body');
	const text = await body.innerText();
	await page.waitForTimeout(800); // a stream left running would keep adding text
	expect(await body.innerText()).toBe(text);
});
