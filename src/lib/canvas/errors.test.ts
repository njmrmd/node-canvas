import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiCallError } from './api-client';
import { COPY } from './copy';
import { presentError, TIMEOUT_ERROR, toNodeError } from './errors';

describe('presentError', () => {
	it('maps a rejected or missing key to the auth line', () => {
		for (const code of ['invalid_api_key', 'no_key_configured'] as const) {
			const p = presentError({ code, message: 'x' });
			assert.equal(p.kind, 'auth');
			assert.equal(p.message, COPY['node.error.auth']);
		}
	});

	it('maps the client-only codes by code, never by message text', () => {
		assert.equal(presentError({ code: 'network', message: 'anything' }).kind, 'network');
		assert.equal(presentError(TIMEOUT_ERROR).kind, 'timeout');
	});

	it('shows a refusal as declined, with the server sentence', () => {
		const p = presentError({ code: 'model_declined', message: 'The model declined to answer this request. Try rephrasing it.' });
		assert.equal(p.kind, 'declined');
		assert.equal(p.category, 'Declined');
		assert.match(p.message, /declined/);
	});

	it('shows rate limits and provider trouble in the server words', () => {
		assert.equal(presentError({ code: 'rate_limited', message: 'Try again in 12 minutes.' }).message, 'Try again in 12 minutes.');
		assert.equal(presentError({ code: 'provider_unavailable', message: 'Could not reach Anthropic.' }).message, 'Could not reach Anthropic.');
	});

	it('treats an over-long branch as too long', () => {
		assert.equal(presentError({ code: 'payload_too_large', message: 'x' }).kind, 'too_long');
		assert.equal(presentError({ code: 'invalid_request', message: 'This branch is too long to send.' }).kind, 'too_long');
	});

	it('never shows an unexpected message verbatim', () => {
		const p = presentError({ code: 'internal_error', message: 'TypeError: x is undefined' });
		assert.equal(p.kind, 'unknown');
		assert.equal(p.message, COPY['node.error.unknown']);
	});
});

describe('toNodeError', () => {
	it('keeps an API error code and message', () => {
		assert.deepEqual(toNodeError(new ApiCallError('rate_limited', 'Slow down.')), { code: 'rate_limited', message: 'Slow down.' });
	});

	it('hides anything else behind a generic internal_error', () => {
		const e = toNodeError(new Error('secret detail'));
		assert.equal(e.code, 'internal_error');
		assert.doesNotMatch(e.message, /secret/);
	});
});
