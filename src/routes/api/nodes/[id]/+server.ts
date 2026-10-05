import { ApiError, withRoute } from '$lib/server/api-error';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { deleteNode, isUuid } from '$lib/server/nodes';
import { enforce, POLICIES, userSubject } from '$lib/server/rate-limit';

export const DELETE = withRoute('nodes.delete', async ({ request, locals, params }) => {
	assertSameOrigin(request);
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	await enforce(POLICIES.nodeWrite, userSubject(user.id));
	if (!isUuid(params.id)) throw new ApiError('invalid_request', 'That node id is malformed.');
	await deleteNode(user.id, params.id); // the subtree cascades
	return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
