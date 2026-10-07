import { expect, test } from './fixtures';

const isCanvasLoad = (url: URL) => url.pathname === '/api/nodes';

test('a failed canvas load says so, and Retry loads it', async ({ page, signIn }) => {
	await signIn({ nodes: 2 });
	let fail = true;
	await page.route(isCanvasLoad, (route) =>
		fail && route.request().method() === 'GET'
			? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal_error', message: 'x' } }) })
			: route.continue()
	);
	await page.goto('/canvas');
	await expect(page.getByText("Couldn't load your canvas. Press Retry; if it keeps failing, reload the page.")).toBeVisible();
	fail = false;
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByLabel('Message')).toBeVisible();
	await expect(page.locator('article[data-node-id]').first()).toBeAttached();
});

test('a stalled canvas load offers Retry, and Retry starts over', async ({ page, signIn }) => {
	await signIn({ nodes: 2 });
	const aborted: string[] = [];
	page.on('requestfailed', (request) => {
		if (isCanvasLoad(new URL(request.url())) && request.failure()?.errorText === 'net::ERR_ABORTED') aborted.push(request.method());
	});
	let stall = true;
	await page.route(isCanvasLoad, (route) => {
		if (stall && route.request().method() === 'GET') return; // never answered: the request hangs
		return route.continue();
	});
	await page.goto('/canvas');
	await expect(page.getByText('Taking longer than expected.')).toBeVisible({ timeout: 10_000 });
	stall = false;
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByLabel('Message')).toBeVisible();
	await expect(page.getByText('Taking longer than expected.')).toHaveCount(0);
	await expect.poll(() => aborted).toEqual(['GET']); // Retry cancelled the stuck request instead of leaving it to answer late
});
