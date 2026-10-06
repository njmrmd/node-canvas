import { expect, test } from './fixtures';

test('offline shows the banner and blocks sending; online clears it', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	// The canvas hydrates after `load`; going offline first would fail its lazy-loaded chunks.
	await expect(page.getByLabel('Message')).toBeVisible();
	await context.setOffline(true);
	await expect(page.getByText("You're offline. Your canvas is here, but new messages will fail.")).toBeVisible();
	await page.getByLabel('Message').fill('hello');
	await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
	await context.setOffline(false);
	await expect(page.getByText("You're offline.")).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a failing save shows the banner, and a later success clears it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	// The canvas loads its nodes with a GET to this same URL: let that finish, and fail only the saves.
	await expect(page.getByLabel('Message')).toBeVisible();
	await page.route('**/api/nodes', (route) =>
		route.request().method() === 'PUT'
			? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal_error","message":"x"}}' })
			: route.continue()
	);
	await page.getByLabel('Message').fill('save me');
	await page.getByLabel('Message').press('Enter');
	await expect(page.getByText("Some changes aren't saved yet.")).toBeVisible({ timeout: 10_000 });
	await page.unroute('**/api/nodes');
	await expect(page.getByText("Some changes aren't saved yet.")).toHaveCount(0, { timeout: 10_000 });
});

test('the usage chip counts this hour’s messages', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByLabel('Message').fill('count me');
	await page.getByLabel('Message').press('Enter');
	await expect(page.getByText('1 / 60 this hour')).toBeVisible();
});

test('the hourly limit blocks sending and says when it resets', async ({ page, signIn }) => {
	await signIn({ chatUsed: 60 });
	await page.goto('/canvas');
	await page.getByLabel('Message').fill('one too many');
	await page.getByLabel('Message').press('Enter');
	const card = page.locator('article[data-node-id]').last();
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText('You have reached the limit of 60');
	await expect(page.getByText(/You've used your 60 messages for this hour\. Resets in/)).toBeVisible();
	await expect(page.getByLabel('Message')).toHaveAttribute('placeholder', 'Hourly limit reached');
});

test('a starter prompt fills the composer', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByRole('button', { name: 'Name this product three different ways' }).click();
	await expect(page.getByLabel('Message')).toHaveValue('Name this product three different ways');
});
