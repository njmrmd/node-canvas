import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { signInHref } from '$lib/auth/next-path';
import { getUserBySessionToken } from '$lib/server/auth/session';
import { SESSION_COOKIE } from '$lib/server/auth/session-cookie';
import { isProtected, SECURITY_HEADERS } from '$lib/server/guard';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getUserBySessionToken(token) : null;

	if (!event.locals.user && isProtected(event.url.pathname)) {
		const location = signInHref(event.url.pathname + event.url.search);
		// A `use:enhance` form action fetch follows a raw 303 and tries to
		// deserialise the resulting HTML as an action result, so a non-GET
		// request needs SvelteKit's own redirect() (which enhance recognises)
		// rather than a Response it will just follow into a parse failure.
		if (event.request.method !== 'GET') redirect(303, location);
		return new Response(null, { status: 303, headers: { location, ...SECURITY_HEADERS } });
	}

	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
};

/** Logs the route, error name and code only; the page gets a generic sentence. */
export const handleError: HandleServerError = ({ error, event, status }) => {
	if (status !== 404) {
		const label = error instanceof Error ? error.name : 'non-Error throw';
		const code =
			error !== null && typeof error === 'object' && typeof (error as Record<string, unknown>).code === 'string'
				? (error as Record<string, unknown>).code
				: undefined;
		console.error(
			`[${event.route.id ?? 'unknown route'}] unhandled error: ${label}${code ? ` code=${code}` : ''}`
		);
	}
	return { message: 'Something went wrong on our side. Please try again.' };
};
