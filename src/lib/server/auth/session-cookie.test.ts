import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cookies } from '@sveltejs/kit';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session-cookie';

function fakeCookies() {
	const calls: { op: string; name: string; value?: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		set: (name: string, value: string, opts: Record<string, unknown>) => calls.push({ op: 'set', name, value, opts }),
		delete: (name: string, opts: Record<string, unknown>) => calls.push({ op: 'delete', name, opts })
	} as unknown as Cookies;
	return { cookies, calls };
}

describe('session cookie', () => {
	it('is httpOnly, SameSite=Lax, site-wide and expires with the session', () => {
		const { cookies, calls } = fakeCookies();
		const expiresAt = new Date(Date.now() + 1000);
		setSessionCookie(cookies, 'tok', expiresAt);
		assert.equal(calls[0].name, SESSION_COOKIE);
		assert.equal(calls[0].value, 'tok');
		assert.equal(calls[0].opts.httpOnly, true);
		assert.equal(calls[0].opts.sameSite, 'lax');
		assert.equal(calls[0].opts.path, '/');
		assert.equal(calls[0].opts.expires, expiresAt);
		assert.notEqual(calls[0].opts.secure, false, 'never explicitly insecure');
	});

	it('clears on the same path', () => {
		const { cookies, calls } = fakeCookies();
		clearSessionCookie(cookies);
		assert.deepEqual(calls[0], { op: 'delete', name: SESSION_COOKIE, opts: { path: '/' } });
	});
});
