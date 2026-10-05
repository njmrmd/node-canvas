import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { GOOD_KEY, startFakeAnthropic } from '../../../tests/support/fake-anthropic';
import { ApiError } from './api-error';
import { streamChat, validateApiKey } from './anthropic';
import type { ChatStreamEvent } from '../shared/chat-types';
import { findModel } from '../shared/models';

let fake: Awaited<ReturnType<typeof startFakeAnthropic>>;
before(async () => {
	fake = await startFakeAnthropic();
	process.env.ANTHROPIC_BASE_URL = fake.url;
});
after(async () => {
	delete process.env.ANTHROPIC_BASE_URL;
	await fake.close();
});

describe('validateApiKey', () => {
	it('accepts a key Anthropic accepts', async () => {
		await validateApiKey(GOOD_KEY);
	});

	it('reports a rejected key as invalid_api_key with an actionable message', async () => {
		await assert.rejects(validateApiKey('sk-ant-api03-wrong'), (error: unknown) => {
			assert.ok(error instanceof ApiError);
			assert.equal(error.code, 'invalid_api_key');
			assert.match(error.message, /Anthropic rejected that key/);
			assert.doesNotMatch(error.message, /sk-ant/);
			return true;
		});
	});

	it('reports an unreachable provider as provider_unavailable', async () => {
		process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
		try {
			await assert.rejects(validateApiKey(GOOD_KEY), (error: unknown) => {
				assert.ok(error instanceof ApiError);
				assert.equal(error.code, 'provider_unavailable');
				return true;
			});
		} finally {
			process.env.ANTHROPIC_BASE_URL = fake.url;
		}
	});
});

async function collect(
	model: string,
	prompt: string,
	signal = new AbortController().signal,
	key = GOOD_KEY
) {
	const events: ChatStreamEvent[] = [];
	for await (const e of streamChat({
		apiKey: key,
		model: findModel(model)!,
		messages: [{ role: 'user', content: prompt }],
		signal
	})) {
		events.push(e);
	}
	return events;
}

describe('streamChat', () => {
	it('streams text and finishes with usage', async () => {
		const events = await collect('claude-opus-5-5', 'hello there');
		const text = events
			.filter((e) => e.type === 'text')
			.map((e) => (e as { text: string }).text)
			.join('');
		assert.match(text, /^Echo: hello there\./);
		const done = events.at(-1);
		assert.equal(done?.type, 'done');
	});

	it('sends adaptive summarized thinking, medium effort and default fallbacks for Opus 5.5', async () => {
		fake.requests.length = 0;
		await collect('claude-opus-5-5', 'check the request');
		const { body, headers } = fake.requests.at(-1)!;
		assert.equal(body.model, 'claude-opus-5-5');
		assert.equal(body.max_tokens, 64000);
		assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
		assert.deepEqual(body.output_config, { effort: 'medium' });
		assert.equal(body.fallbacks, 'default');
		assert.match(String(headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
	});

	it('omits thinking, effort and fallbacks for Haiku 4.5', async () => {
		fake.requests.length = 0;
		await collect('claude-haiku-4-5', 'quick one');
		const { body, headers } = fake.requests.at(-1)!;
		assert.equal('thinking' in body, false);
		assert.equal('output_config' in body, false);
		assert.equal('fallbacks' in body, false);
		assert.doesNotMatch(String(headers['anthropic-beta'] ?? ''), /server-side-fallback/);
	});

	it('streams the thinking summary as thinking events', async () => {
		const events = await collect('claude-opus-5-5', '[think] why');
		assert.ok(events.some((e) => e.type === 'thinking'));
	});

	it('turns a refusal into a model_declined error event', async () => {
		const events = await collect('claude-opus-5-5', '[refuse] no');
		assert.deepEqual(events.at(-1), {
			type: 'error',
			code: 'model_declined',
			message: 'The model declined to answer this request. Try rephrasing it.'
		});
	});

	it('turns a rejected key into an invalid_api_key error event', async () => {
		const events = await collect('claude-opus-5-5', 'hi', new AbortController().signal, 'sk-ant-wrong');
		const last = events.at(-1);
		assert.equal(last?.type, 'error');
		assert.equal(last?.type === 'error' && last.code, 'invalid_api_key');
	});

	it('ends quietly, with no error event, when the caller aborts', async () => {
		const controller = new AbortController();
		const events: ChatStreamEvent[] = [];
		for await (const e of streamChat({
			apiKey: GOOD_KEY,
			model: findModel('claude-opus-5-5')!,
			messages: [{ role: 'user', content: '[slow][long] go' }],
			signal: controller.signal
		})) {
			events.push(e);
			if (events.length === 3) controller.abort();
		}
		assert.equal(
			events.some((e) => e.type === 'error' || e.type === 'done'),
			false
		);
	});
});
