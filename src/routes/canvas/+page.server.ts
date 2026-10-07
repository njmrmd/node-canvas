import { getKeySummary } from '$lib/server/keys';
import { loadView } from '$lib/server/nodes';
import { DEFAULT_MODEL_ID, MODELS } from '$lib/shared/models';
import type { PageServerLoad } from './$types';

/**
 * A server load also makes the hook's sign-in guard run on client-side navigation. The nodes are
 * not here: the browser fetches them page by page from GET /api/nodes, so no canvas is too big to open.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // hooks.server.ts redirects signed-out requests
	const [view, key] = await Promise.all([loadView(user.id), getKeySummary(user.id)]);
	return { view, hasKey: key !== null, email: user.email, models: MODELS, defaultModelId: DEFAULT_MODEL_ID };
};
