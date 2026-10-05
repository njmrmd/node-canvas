import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';

const node = (id = randomUUID(), parentId: string | null = null) => ({
	id,
	parentId,
	prompt: `hello from e2e ${id.slice(0, 6)}`,
	response: 'saved answer',
	thinking: '',
	status: 'complete',
	error: null,
	usage: null,
	model: 'claude-opus-5-5',
	x: 0,
	y: 0,
	positionMode: 'auto',
	width: null,
	height: null,
	collapsed: false,
	bodyCollapsed: false,
	createdAt: Date.now(),
	updatedAt: Date.now()
});

test('saves nodes, returns them from the canvas load, and deletes subtrees', async ({ page, signIn }) => {
	await signIn();
	const root = node();
	const child = node(randomUUID(), root.id);
	const put = await page.request.put('/api/nodes', { data: { upserts: [child, root] } });
	expect(put.status()).toBe(200);
	expect(await put.json()).toEqual({ rejected: [] });
	expect(await (await page.request.get('/canvas/__data.json')).text()).toContain(root.prompt);

	expect((await page.request.delete(`/api/nodes/${root.id}`)).status()).toBe(204);
	const after = await (await page.request.get('/canvas/__data.json')).text();
	expect(after).not.toContain(root.prompt);
	expect(after).not.toContain(child.prompt);
});

test('refuses unauthenticated, cross-site and malformed saves', async ({ page, signIn }) => {
	expect((await page.request.put('/api/nodes', { data: { upserts: [] } })).status()).toBe(401);
	await signIn();
	expect(
		(await page.request.put('/api/nodes', { data: { upserts: [] }, headers: { 'sec-fetch-site': 'cross-site' } })).status()
	).toBe(403);
	expect((await page.request.put('/api/nodes', { data: { upserts: [{ id: 'nope' }] } })).status()).toBe(400);
	expect((await page.request.delete('/api/nodes/not-a-uuid')).status()).toBe(400);
});
