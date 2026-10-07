import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANTHROPIC_KEYS_URL, LANDING_COPY, SOURCE_URL } from './landing';

/** Every string inside a nested value. */
const strings = (value: unknown): string[] =>
	typeof value === 'string'
		? [value]
		: Array.isArray(value)
			? value.flatMap(strings)
			: value && typeof value === 'object'
				? Object.values(value).flatMap(strings)
				: [];

describe('landing copy', () => {
	it('keeps the canvas tone: no exclamation marks, no apologies', () => {
		for (const s of strings(LANDING_COPY)) {
			assert.ok(!s.includes('!'), s);
			assert.doesNotMatch(s, /\b(oops|sorry|whoops)\b/i, s);
		}
	});

	it('fits a link card: the description stays under 200 characters', () => {
		assert.ok(LANDING_COPY.description.length <= 200, `${LANDING_COPY.description.length} characters`);
	});

	it('names the three steps in order', () => {
		assert.deepEqual(
			LANDING_COPY.steps.map((s) => s.title),
			['Create an account', 'Connect an Anthropic key', 'Branch the conversation']
		);
	});

	it('links out over https', () => {
		for (const url of [ANTHROPIC_KEYS_URL, SOURCE_URL]) assert.match(url, /^https:\/\//);
	});
});
