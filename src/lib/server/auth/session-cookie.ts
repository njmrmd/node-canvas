import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'nc_session';

/**
 * httpOnly: page scripts can never read it. SameSite=Lax: no cross-site POSTs.
 * `secure` is SvelteKit's default — true everywhere except http://localhost.
 */
export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', expires: expiresAt });
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
