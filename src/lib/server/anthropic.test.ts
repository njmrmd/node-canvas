import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { GOOD_KEY, startFakeAnthropic } from '../../../tests/support/fake-anthropic';
import { ApiError } from './api-error';
import { validateApiKey } from './anthropic';

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
