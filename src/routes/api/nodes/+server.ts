import { json } from '@sveltejs/kit';
import { ApiError, readJsonBody, withRoute } from '$lib/server/api-error';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { decodeCursor, encodeCursor, loadNodesPage, MAX_SAVE_BYTES, parseSaveBody, saveNodes } from '$lib/server/nodes';
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

/** One page of the canvas load. Reads need the session, not the same-origin check (no state changes). */
export const GET = withRoute('nodes.get', async ({ url, locals }) => {
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	const raw = url.searchParams.get('after');
	const after = raw === null ? null : decodeCursor(raw);
	if (raw !== null && !after) throw new ApiError('invalid_request', 'That page cursor is malformed.');
	const page = await loadNodesPage(user.id, after);
	return json(
		{ nodes: page.nodes, next: page.next && encodeCursor(page.next) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
});
