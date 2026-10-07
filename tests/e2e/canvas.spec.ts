import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';
import { cards, savedNodesText, send } from './helpers';
import type { Page } from '@playwright/test';

/** Waits until the canvas load returns `needle` — i.e. the saver has flushed. */
async function waitSaved(page: Page, needle: string) {
	await expect.poll(() => savedNodesText(page), { timeout: 15_000 }).toContain(needle);
}

test('without a key, the canvas sends you to connect one', async ({ page, signIn }) => {
	await signIn({ key: false });
	await page.goto('/canvas');
	await expect(page.getByText('Connect a model to start')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Connect model access' })).toHaveAttribute('href', '/keys');
});

test('send, stream, and find it again after a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await expect(page.getByText('Ask anything. Then take it three directions.')).toBeVisible();
	const id = await send(page, 'first question');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: first question.');
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', id);
	await waitSaved(page, 'Echo: first question.');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${id}"]`)).toContainText('Echo: first question.');
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'complete');
});

test('a frame type this page does not know is skipped, and the reply is saved', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	// A newer server can send a frame type an open tab has never seen, as Plan 3's ping was to Plan 2's tabs.
	const frames = [
		{ type: 'ping' },
		{ type: 'text', text: 'Before the new frame, ' },
		{ type: 'a_frame_from_a_newer_server' },
		{ type: 'text', text: 'and after it.' },
		{ type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 2 } }
	];
	await page.route('**/api/chat', (route) =>
		route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') })
	);
	const id = await send(page, 'a reply from a newer server');
	await expect(page.locator(`article[data-node-id="${id}"]`)).toContainText('Before the new frame, and after it.');
	// Had the frame failed the card, the error it left would make the server refuse the node, and the reply would be lost.
	await waitSaved(page, 'Before the new frame, and after it.');
});

test('branching sends exactly the ancestor path', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'root question');
	const b = await send(page, 'second question');
	await page.locator(`article[data-node-id="${a}"] button[aria-label="Branch"]`).click();
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', a);
	await resetAnthropic();
	const c = await send(page, 'forked question');
	await expect(page.locator(`article[data-node-id="${c}"]`)).toHaveAttribute('data-parent-id', a);
	const [sent] = await anthropicRequests();
	const prompts = (sent.body.messages as { role: string; content: string }[]).map((m) => `${m.role}:${m.content.slice(0, 20)}`);
	expect(prompts).toEqual(['user:root question', expect.stringMatching(/^assistant:Echo: root question/), 'user:forked question']);
	expect(b).not.toBe(c);
});

test('markdown renders and HTML stays text', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[markdown] format please');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card.locator('strong')).toHaveText('bold');
	await expect(card.locator('li')).toHaveCount(2);
	await expect(card.locator('pre code')).toHaveText('const x = 1;');
	await expect(card.locator('img')).toHaveCount(0);
	await expect(card).toContainText('<img src=x onerror=');
	expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('shows the reasoning summary, and a refusal as declined', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const thought = await send(page, '[think] consider this');
	await expect(page.locator(`article[data-node-id="${thought}"] details summary`)).toHaveText('Reasoning summary');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const refused = await send(page, '[refuse] nope', { wait: false });
	const card = page.locator(`article[data-node-id="${refused}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText('The model declined to answer this request.');
});

test('stop keeps the partial reply', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const stopped = await send(page, '[slow][long] stop me', { wait: false });
	const card = page.locator(`article[data-node-id="${stopped}"]`);
	await expect(card).toContainText('Echo: stop me.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await expect(card).toHaveAttribute('data-status', 'interrupted');
	await expect(card).toContainText('Stopped');
});

test('reload mid-stream keeps the partial reply as stopped', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const reloaded = await send(page, '[slow][long] reload me', { wait: false });
	await expect(page.locator(`article[data-node-id="${reloaded}"]`)).toContainText('Echo: reload me.');
	await waitSaved(page, 'Echo: reload me.');
	await page.reload();
	const after = page.locator(`article[data-node-id="${reloaded}"]`);
	await expect(after).toHaveAttribute('data-status', 'interrupted');
	await expect(after).toContainText('Echo: reload me.');
	// This user has no other node, so "interrupted" in the saved data is this one, saved back.
	await waitSaved(page, '"interrupted"');
});

test('a 350 KB reply survives a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[huge] write a lot');
	await waitSaved(page, 'END-OF-HUGE');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${id}"]`)).toContainText('END-OF-HUGE');
});

test('leaving the canvas by an in-app link keeps the finished reply', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'leave right after');
	await page.getByRole('link', { name: 'Account' }).click();
	await page.waitForURL('**/keys');
	await page.goto('/canvas');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'complete');
	await expect(card).toContainText('Echo: leave right after.');
});

test('an over-long message is refused in the composer and the draft is kept', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const draft = 'x'.repeat(100_001);
	await page.getByLabel('Message').fill(draft);
	await expect(page.getByText('This message is too long to send. Shorten it to under 100,000 characters.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
	await page.getByLabel('Message').press('Enter');
	await expect(cards(page)).toHaveCount(0);
	await expect(page.getByLabel('Message')).toHaveValue(draft);
	await page.getByLabel('Message').fill('x'.repeat(100_000));
	await expect(page.getByText('This message is too long to send.')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a reply that did not finish says so in the composer instead of waiting forever', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const refused = await send(page, '[refuse] nope', { wait: false });
	await expect(page.locator(`article[data-node-id="${refused}"]`)).toHaveAttribute('data-status', 'error');
	await expect(page.locator(`article[data-node-id="${refused}"] button[aria-label="Branch"]`)).toHaveAttribute(
		'title',
		"This reply has no text to build on. Branch from another card, or start a new conversation."
	);
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', refused);
	await expect(page.getByLabel('Message')).toHaveAttribute(
		'placeholder',
		"This reply has no text to build on. Branch from another card, or start a new conversation."
	);
	await page.getByLabel('Message').fill('follow up');
	await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
	await page.getByRole('button', { name: 'New conversation' }).click();
	await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a reply that finished empty says so in the composer instead of waiting forever', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[empty] say nothing');
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'complete');
	await expect(page.getByLabel('Message')).toHaveAttribute(
		'placeholder',
		"This reply has no text to build on. Branch from another card, or start a new conversation."
	);
	// The card says the same: its Branch button is off, and its tooltip is the same sentence.
	const branch = page.locator(`article[data-node-id="${id}"] button[aria-label="Branch"]`);
	await expect(branch).toBeDisabled();
	await expect(branch).toHaveAttribute('title', "This reply has no text to build on. Branch from another card, or start a new conversation.");
});
