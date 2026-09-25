import { fail, redirect } from '@sveltejs/kit';
import { checkCredentials, normaliseEmail } from '$lib/auth/credentials';
import { resolveNextPath } from '$lib/auth/next-path';
import { AUTH_MESSAGES } from '$lib/copy/auth';
import { createSession } from '$lib/server/auth/session';
import { setSessionCookie } from '$lib/server/auth/session-cookie';
import { hashPassword } from '$lib/server/crypto/password';
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

		// Validation first: a typo must not spend the IP's sign-up budget.
		const fields = checkCredentials('sign-up', { email, password });
		if (Object.keys(fields).length) return fail(400, { email, fields });

		const limited = await rateLimitMessage(POLICIES.signUp, ipSubject(getClientAddress()));
		if (limited) return fail(429, { email, message: limited });

		const row = await queryOne<{ id: string }>(
			'insert into users (email, password_hash) values ($1, $2) on conflict (email) do nothing returning id',
			[normaliseEmail(email), await hashPassword(password)]
		);
		if (!row) return fail(409, { email, message: AUTH_MESSAGES.emailTaken });

		const session = await createSession(row.id);
		setSessionCookie(cookies, session.token, session.expiresAt);
		redirect(303, resolveNextPath(url.searchParams.get('next')));
	}
};
