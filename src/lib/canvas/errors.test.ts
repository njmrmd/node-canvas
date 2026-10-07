import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiCallError } from './api-client';
import { COPY } from './copy';
import { presentError, TIMEOUT_ERROR, toNodeError } from './errors';

describe('presentError', () => {
	it('maps a rejected key and a missing key to their own lines, each with the way to the key page', () => {
		const rejected = presentError({ code: 'invalid_api_key', message: 'x' });
		assert.equal(rejected.kind, 'auth');
		assert.equal(rejected.message, COPY['node.error.auth']);
		assert.deepEqual(rejected.action, { label: 'Open the key page', to: 'keys' });
		const missing = presentError({ code: 'no_key_configured', message: 'x' });
		assert.equal(missing.kind, 'auth');
		assert.equal(missing.message, 'No model key is connected. Connect one on the key page.');
		assert.deepEqual(missing.action, { label: 'Open the key page', to: 'keys' });
	});

	it('says a signed-out session is signed out, with the way back in', () => {
		const p = presentError({ code: 'unauthenticated', message: 'Please sign in to continue.' });
		assert.equal(p.kind, 'signed_out');
		assert.equal(p.category, 'Signed out');
		assert.equal(
			p.message,
			"You've been signed out. Sign in again in the new tab this opens, then come back here — this tab keeps your changes and saves them."
		);
		assert.deepEqual(p.action, { label: 'Sign in (new tab)', to: 'sign-in' });
	});

	it('says a model that is no longer offered is unavailable, and where to pick another', () => {
		const p = presentError({ code: 'unsupported_model', message: 'x' });
		assert.equal(p.kind, 'model');
		assert.equal(p.message, "This model isn't available any more. Choose another in the top bar, then press Retry.");
		assert.equal(p.action, null);
	});

	it('gives every other failure no action', () => {
		// invalid_request with a message that is not about length, and not_found (a code no line is written for), fall to the generic line.
		for (const code of [
			'network',
			'timeout',
			'model_declined',
			'rate_limited',
			'provider_unavailable',
			'internal_error',
			'payload_too_large',
			'invalid_request',
			'not_found'
		] as const) {
			assert.equal(presentError({ code, message: 'x' }).action, null, code);
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
