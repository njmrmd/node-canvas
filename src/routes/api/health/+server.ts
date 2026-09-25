import { json } from '@sveltejs/kit';

export const GET = () =>
	json(
		{ ok: true, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local' },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
