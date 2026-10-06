import { getKeySummary } from '$lib/server/keys';
import { loadCanvas } from '$lib/server/nodes';
import { DEFAULT_MODEL_ID, MODELS } from '$lib/shared/models';
import type { PageServerLoad } from './$types';

/** A server load also makes the hook's sign-in guard run on client-side navigation. */
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // hooks.server.ts redirects signed-out requests
	const [canvas, key] = await Promise.all([loadCanvas(user.id), getKeySummary(user.id)]);
	return { ...canvas, hasKey: key !== null, email: user.email, models: MODELS, defaultModelId: DEFAULT_MODEL_ID };
};
