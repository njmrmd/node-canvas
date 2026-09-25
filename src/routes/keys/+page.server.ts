import { fail, redirect } from '@sveltejs/kit';
import { KEYS_COPY } from '$lib/copy/auth';
import { ApiError } from '$lib/server/api-error';
import { validateApiKey } from '$lib/server/anthropic';
import { deleteSession } from '$lib/server/auth/session';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/auth/session-cookie';
import { query } from '$lib/server/db';
import { rateLimitMessage, str } from '$lib/server/form';
import { deleteKey, getKeySummary, saveKey } from '$lib/server/keys';
import { POLICIES, userSubject } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const MAX_KEY_LENGTH = 300;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // hooks.server.ts redirects signed-out requests
	return { email: user.email, key: await getKeySummary(user.id) };
};

function requireUser(locals: App.Locals) {
	if (!locals.user) redirect(303, '/sign-in?next=%2Fkeys');
	return locals.user;
}

export const actions: Actions = {
	connect: async ({ request, locals }) => {
		const user = requireUser(locals);
		const apiKey = str((await request.formData()).get('apiKey')).trim();
		if (!apiKey) return fail(400, { action: 'connect', fields: { apiKey: KEYS_COPY.emptyKey } });
		if (apiKey.length > MAX_KEY_LENGTH) {
			return fail(400, { action: 'connect', fields: { apiKey: KEYS_COPY.longKey } });
		}

		const limited = await rateLimitMessage(POLICIES.keyWrite, userSubject(user.id));
		if (limited) return fail(429, { action: 'connect', message: limited });

		try {
			await validateApiKey(apiKey);
		} catch (error) {
			if (error instanceof ApiError) {
				return fail(error.code === 'invalid_api_key' ? 400 : 502, { action: 'connect', message: error.message });
			}
			throw error;
		}

		const saved = await saveKey(user.id, apiKey);
		return { action: 'connect', saved: saved.last4 };
	},

	remove: async ({ locals }) => {
		const user = requireUser(locals);
		await deleteKey(user.id);
		return { action: 'remove' };
	},

	signOut: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await deleteSession(token); // revoke server-side first
		clearSessionCookie(cookies);
		redirect(303, '/');
	},

	deleteAccount: async ({ request, locals, cookies }) => {
		const user = requireUser(locals);
		if (str((await request.formData()).get('confirm')) !== 'yes') {
			return fail(400, { action: 'deleteAccount', message: KEYS_COPY.deleteUnconfirmed });
		}
		// One statement; sessions, key, nodes and view cascade from users.
		await query('delete from users where id = $1', [user.id]);
		clearSessionCookie(cookies);
		redirect(303, '/');
	}
};
