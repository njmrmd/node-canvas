import { json } from '@sveltejs/kit';
import { ApiError, readJsonBody, withRoute } from '$lib/server/api-error';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { MAX_SAVE_BYTES, parseSaveBody, saveNodes } from '$lib/server/nodes';
import { enforce, POLICIES, rateLimitHeaders, userSubject } from '$lib/server/rate-limit';

export const PUT = withRoute('nodes.put', async ({ request, locals }) => {
	assertSameOrigin(request);
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	const limit = await enforce(POLICIES.nodeWrite, userSubject(user.id));
	const { upserts, view } = parseSaveBody(await readJsonBody(request, { maxBytes: MAX_SAVE_BYTES }));
	const result = await saveNodes(user.id, upserts, view);
	return json(result, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(limit) } });
});
