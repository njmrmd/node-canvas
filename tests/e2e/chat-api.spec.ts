import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';

const body = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hello relay' }] };
const frames = (raw: string) => raw.split('\n\n').filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6)));

test('streams SSE frames for a signed-in user with a key', async ({ page, signIn }) => {
	await signIn();
	await resetAnthropic();
	const res = await page.request.post('/api/chat', { data: body });
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('text/event-stream');
	expect(res.headers()['ratelimit-limit']).toBe('60');
	const text = await res.text();
	expect(text).toContain('"type":"ping"');
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
	expect(bad.headers()['ratelimit-limit']).toBe('60');
});

test('says no key is configured before streaming', async ({ page, signIn }) => {
	await signIn({ key: false });
	const res = await page.request.post('/api/chat', { data: body });
	expect(res.status()).toBe(409);
	expect((await res.json()).error.code).toBe('no_key_configured');
	// A pre-stream failure after the limit check still reports the limit.
	expect(res.headers()['ratelimit-limit']).toBe('60');
});

test('an error part-way through arrives as an error frame after the text so far', async ({ page, signIn }) => {
	await signIn();
	const res = await page.request.post('/api/chat', { data: { ...body, messages: [{ role: 'user', content: '[midfail] break' }] } });
	expect(res.status()).toBe(200);
	const events = frames(await res.text());
	expect(events.some((e) => e.type === 'text')).toBe(true);
	expect(events.at(-1)).toMatchObject({ type: 'error', code: 'provider_unavailable' });
});

test('a request body over 2 MB is refused before it reaches Anthropic', async ({ page, signIn }) => {
	await signIn();
	await resetAnthropic();
	const res = await page.request.post('/api/chat', {
		data: { ...body, messages: [{ role: 'user', content: 'x'.repeat(2_100_000) }] }
	});
	expect(res.status()).toBe(413);
	expect((await res.json()).error.code).toBe('payload_too_large');
	expect(res.headers()['ratelimit-limit']).toBe('60');
	expect(await anthropicRequests()).toHaveLength(0);
});
