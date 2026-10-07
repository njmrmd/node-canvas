import { expect, test } from './fixtures';
import { fit, send } from './helpers';

test('cards off the path to the composer target are dimmed, and the toggle turns it off', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'first root');
	const b = await send(page, 'its reply');
	await expect(page.locator('.svelte-flow__edge.on-path')).toHaveCount(1);
	await expect(page.locator('.svelte-flow__edge.on-path .svelte-flow__edge-path')).toHaveCSS('stroke-width', '2px');
	await expect(page.locator('.svelte-flow__edge.on-path')).toHaveCSS('transition-property', 'opacity');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const c = await send(page, 'second root');
	const card = (id: string) => page.locator(`article[data-node-id="${id}"]`);
	await fit(page);
	await page.mouse.move(2, 2); // over the top bar: no card is hovered, so dimming shows
	await expect(card(a)).toHaveCSS('opacity', '0.75');
	await expect(card(a)).toHaveClass(/\bdim\b/);
	await expect(card(b)).toHaveClass(/\bdim\b/);
	await expect(card(c)).not.toHaveClass(/\bdim\b/);
	await card(a).getByRole('button', { name: 'Branch' }).click();
	await expect(card(a)).not.toHaveClass(/\bdim\b/);
	await expect(card(b)).toHaveClass(/\bdim\b/); // below the target is off the root → target path
	await expect(card(c)).toHaveClass(/\bdim\b/);
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(page.locator('article.dim')).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('article.dim')).toHaveCount(0);
});

test('a failed card off the path stays at full strength, so its error reads', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const failed = await send(page, '[refuse] off the path', { wait: false });
	await expect(page.locator(`article[data-node-id="${failed}"]`)).toHaveAttribute('data-status', 'error');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const other = await send(page, 'on the path');
	await expect(page.locator(`article[data-node-id="${other}"]`)).not.toHaveClass(/\bdim\b/);
	await expect(page.locator(`article[data-node-id="${failed}"]`)).not.toHaveClass(/\bdim\b/);
});

test('the linear view shows the path to the target and copies it', async ({ page, context, signIn }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await signIn();
	await page.goto('/canvas');
	await send(page, 'question one');
	await send(page, 'question two');
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel.locator('.you')).toHaveText(['question one', 'question two']);
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(panel.locator('.reply').first()).toContainText('Echo: question one.');
	await panel.getByRole('button', { name: 'Copy all' }).click();
	await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
	const text = await page.evaluate(() => navigator.clipboard.readText());
	expect(text).toMatch(/^You: question one\n\nAssistant: Echo: question one\.[\s\S]*\n\n---\n\nYou: question two\n\nAssistant: Echo: question two\./);
	await panel.getByRole('button', { name: 'Close linear view' }).click();
	await expect(panel).toHaveCount(0);
});

test('Copy all says so when the clipboard refuses', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'copy refused');
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
			configurable: true
		});
	});
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await panel.getByRole('button', { name: 'Copy all' }).click();
	await expect(panel.getByRole('button', { name: "Couldn't copy" })).toBeVisible();
});

test('a streaming reply in the linear view rewrites only its last paragraph', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	// [long] puts a blank line after every 40 words; [slow] spaces the tokens 60 ms apart, so paragraphs arrive one by one.
	await send(page, '[slow][long] several paragraphs', { wait: false });
	const reply = panel.locator('.reply');
	const chunks = reply.locator(':scope > span');
	await expect.poll(() => chunks.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
	type Watch = { spans: Element[]; texts: (string | null)[]; touched: (number | 'added')[]; observer: MutationObserver };
	// The chunks drawn now, and from here on which of them each mutation touches.
	const recorded = await reply.evaluate((el) => {
		const spans = [...el.children];
		const touched: (number | 'added')[] = [];
		const observer = new MutationObserver((records) => {
			for (const r of records) {
				const span = (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.reply > span');
				const i = span ? spans.indexOf(span) : -1;
				touched.push(i === -1 ? 'added' : i); // a new chunk, or the reply itself gaining one
			}
		});
		observer.observe(el, { subtree: true, childList: true, characterData: true });
		(window as unknown as { __watch: Watch }).__watch = { spans, texts: spans.map((s) => s.textContent), touched, observer };
		return spans.length;
	});
	// More tokens arrive, at least as far as the next paragraph.
	await expect.poll(() => chunks.count(), { timeout: 20_000 }).toBeGreaterThan(recorded);
	const after = await reply.evaluate((el) => {
		const { spans, texts, touched, observer } = (window as unknown as { __watch: Watch }).__watch;
		observer.disconnect();
		const now = [...el.children];
		return {
			earlierKept: spans.slice(0, -1).map((s, i) => s === now[i] && s.textContent === texts[i]),
			lastGrewInPlace: spans.at(-1) === now[spans.length - 1] && !!now[spans.length - 1].textContent?.startsWith(texts.at(-1) ?? ''),
			touchedRecorded: [...new Set(touched.filter((t) => t !== 'added'))],
			added: touched.includes('added')
		};
	});
	// The earlier chunks are the same elements with the same text; only the last one, and the new ones, changed.
	expect(after.earlierKept).toEqual(Array(recorded - 1).fill(true));
	expect(after.lastGrewInPlace).toBe(true);
	expect(after.touchedRecorded.filter((i) => i !== recorded - 1)).toEqual([]);
	expect(after.added).toBe(true);
});

test('the shortcuts sheet lists all 21 shortcuts', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
	const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(sheet.locator('kbd')).toHaveCount(21);
	await expect(sheet).toContainText('Move focus to parent / first child / sibling');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toHaveCount(0);
});
