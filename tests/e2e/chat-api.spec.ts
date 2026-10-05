import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';

const body = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hello relay' }] };

test('streams SSE frames for a signed-in user with a key', async ({ page, signIn }) => {
	await signIn();
	await resetAnthropic();
	const res = await page.request.post('/api/chat', { data: body });
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('text/event-stream');
	expect(res.headers()['ratelimit-limit']).toBe('60');
	const text = await res.text();
	expect(text).toContain('"type":"text"');
	expect(text).toContain('"type":"done"');
	// The fake streams one word per frame, so the echo is only whole once the text deltas are joined.
	const streamed = text
		.split('\n\n')
		.filter((frame) => frame.startsWith('data: '))
		.map((frame) => JSON.parse(frame.slice('data: '.length)))
		.filter((event) => event.type === 'text')
		.map((event) => event.text)
		.join('');
	expect(streamed).toContain('Echo: hello relay.');
	const [sent] = await anthropicRequests();
	expect(sent.body.messages).toEqual(body.messages);
});

test('refuses without a session, from another site, or with a bad model', async ({ page, signIn }) => {
	expect((await page.request.post('/api/chat', { data: body })).status()).toBe(401);
	await signIn();
	expect(
		(await page.request.post('/api/chat', { data: body, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })).status()
	).toBe(403);
	const bad = await page.request.post('/api/chat', { data: { ...body, model: 'gpt-5' } });
	expect(bad.status()).toBe(400);
	expect((await bad.json()).error.code).toBe('unsupported_model');
});

test('says no key is configured before streaming', async ({ page, signIn }) => {
	await signIn({ key: false });
	const res = await page.request.post('/api/chat', { data: body });
	expect(res.status()).toBe(409);
	expect((await res.json()).error.code).toBe('no_key_configured');
});
