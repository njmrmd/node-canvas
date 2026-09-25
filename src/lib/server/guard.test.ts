import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProtected, SECURITY_HEADERS } from './guard';

describe('guard', () => {
	it('protects the canvas and keys screens and their subpaths', () => {
		for (const p of ['/canvas', '/keys', '/canvas/anything']) assert.equal(isProtected(p), true, p);
	});

	it('leaves public pages and look-alikes public', () => {
		for (const p of ['/', '/sign-in', '/sign-up', '/api/health', '/keysmith', '/canvases']) {
			assert.equal(isProtected(p), false, p);
		}
	});

	it('sets the fixed security headers', () => {
		assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
		assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY');
		assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin');
		assert.match(SECURITY_HEADERS['Strict-Transport-Security'], /max-age=63072000/);
		assert.match(SECURITY_HEADERS['Permissions-Policy'], /camera=\(\)/);
	});
});
