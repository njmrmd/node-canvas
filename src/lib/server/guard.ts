const PROTECTED = ['/canvas', '/keys'];

/** Pages that need a signed-in user. JSON routes check the session themselves. */
export function isProtected(pathname: string): boolean {
	return PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Fixed headers on every response. The CSP comes from kit.csp in vite.config.ts. */
export const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
