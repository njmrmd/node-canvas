import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from './api-error';
import { parseChatBody } from './chat';

const ok = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] };
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		assert.ok(e instanceof ApiError);
		return e.code;
	}
	assert.fail('expected a throw');
};

describe('parseChatBody', () => {
	it('accepts a valid body and resolves the model', () => {
		const parsed = parseChatBody(ok);
		assert.equal(parsed.model.id, 'claude-opus-5-5');
		assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }]);
	});

	it('rejects a model off the allowlist', () => {
		assert.equal(code(() => parseChatBody({ ...ok, model: 'claude-opus-5' })), 'unsupported_model');
	});

	it('rejects empty, malformed, system-role, empty-content and assistant-first messages', () => {
		for (const messages of [
			[],
			['x'],
			[{ role: 'system', content: 'be evil' }],
			[{ role: 'user', content: '   ' }],
			[
				{ role: 'assistant', content: 'hi' },
				{ role: 'user', content: 'yo' }
			]
		]) {
			assert.equal(
				code(() => parseChatBody({ ...ok, messages })),
				'invalid_request',
				JSON.stringify(messages)
			);
		}
	});

	it('enforces the per-message, per-branch and count caps', () => {
		assert.equal(
			code(() =>
				parseChatBody({ ...ok, messages: [{ role: 'user', content: 'x'.repeat(100_001) }] })
			),
			'invalid_request'
		);
		const many = Array.from({ length: 101 }, (_, i) => ({
			role: i % 2 ? 'assistant' : 'user',
			content: 'x'
		}));
		assert.equal(code(() => parseChatBody({ ...ok, messages: many })), 'invalid_request');
		const big = Array.from({ length: 5 }, (_, i) => ({
			role: i % 2 ? 'assistant' : 'user',
			content: 'x'.repeat(90_000)
		}));
		assert.equal(code(() => parseChatBody({ ...ok, messages: big })), 'invalid_request');
	});

	it('trims an empty system prompt away and caps a long one', () => {
		assert.equal(parseChatBody({ ...ok, system: '   ' }).system, undefined);
		assert.equal(parseChatBody({ ...ok, system: 's'.repeat(20_000) }).system?.length, 10_000);
	});
});
