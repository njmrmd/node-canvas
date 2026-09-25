import { fail, redirect } from '@sveltejs/kit';
import { checkCredentials, normaliseEmail } from '$lib/auth/credentials';
import { resolveNextPath } from '$lib/auth/next-path';
import { AUTH_MESSAGES } from '$lib/copy/auth';
import { createSession, deleteExpiredSessions } from '$lib/server/auth/session';
import { setSessionCookie } from '$lib/server/auth/session-cookie';
import { dummyPasswordHash, verifyPassword } from '$lib/server/crypto/password';
import { queryOne } from '$lib/server/db';
import { rateLimitMessage, str } from '$lib/server/form';
import { ipSubject, POLICIES } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, resolveNextPath(url.searchParams.get('next')));
	return { next: url.searchParams.get('next') };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const data = await request.formData();
		const email = str(data.get('email'));
		const password = str(data.get('password'));

		const fields = checkCredentials('sign-in', { email, password });
		if (Object.keys(fields).length) return fail(400, { email, fields });

		const limited = await rateLimitMessage(POLICIES.signIn, ipSubject(getClientAddress()));
		if (limited) return fail(429, { email, message: limited });

		const row = await queryOne<{ id: string; password_hash: string }>(
			'select id, password_hash from users where email = $1',
			[normaliseEmail(email)]
		);
		// Always run scrypt, so response time does not reveal whether the email exists.
		const verified = await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()));
		if (!row || !verified) return fail(401, { email, message: AUTH_MESSAGES.badCredentials });

		await deleteExpiredSessions();
		const session = await createSession(row.id);
		setSessionCookie(cookies, session.token, session.expiresAt);
		redirect(303, resolveNextPath(url.searchParams.get('next')));
	}
};
