import type { Config } from '@sveltejs/adapter-vercel';
import { ApiError, readJsonBody, withRoute } from '$lib/server/api-error';
import { streamChat } from '$lib/server/anthropic';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { parseChatBody } from '$lib/server/chat';
import { getDecryptedKey } from '$lib/server/keys';
import { enforce, POLICIES, rateLimitHeaders, userSubject } from '$lib/server/rate-limit';
import { MAX_BODY_BYTES } from '$lib/shared/chat-limits';
import type { ChatStreamEvent } from '$lib/shared/chat-types';

// max_tokens 64000 can outlast 300 s. Pro with Fluid compute allows 800.
export const config: Config = { maxDuration: 800 };

const frame = (event: ChatStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

/**
 * The stateless relay. Pre-stream failures are the JSON envelope; once the
 * stream is open, failures arrive as an `error` frame with the same codes.
 * The provider key is decrypted here, after the session check, and nowhere else.
 */
export const POST = withRoute('chat', async ({ request, locals }) => {
	assertSameOrigin(request);
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	const limit = await enforce(POLICIES.chat, userSubject(user.id));
	// From here on every response, including a pre-stream failure, carries the
	// caller's RateLimit-* headers. 401 and 403 precede the limit, so they don't.
	try {
		const { model, messages, system } = parseChatBody(await readJsonBody(request, { maxBytes: MAX_BODY_BYTES }));
		const apiKey = await getDecryptedKey(user.id);

		// Abort upstream when the browser leaves, so a closed tab stops spending the user's tokens.
		const controller = new AbortController();
		request.signal.addEventListener('abort', () => controller.abort());
		const encoder = new TextEncoder();
		let closed = false;

		const stream = new ReadableStream<Uint8Array>({
			async start(out) {
				try {
					for await (const event of streamChat({ apiKey, model, messages, system, signal: controller.signal })) {
						if (closed) break;
						out.enqueue(encoder.encode(frame(event)));
					}
				} catch (error) {
					if (!closed) {
						console.error('[chat] stream failed:', error instanceof Error ? error.name : 'non-Error throw');
						out.enqueue(
							encoder.encode(frame({ type: 'error', code: 'internal_error', message: 'The response stopped unexpectedly. Please try again.' }))
						);
					}
				} finally {
					if (!closed) out.close();
				}
			},
			cancel() {
				closed = true;
				controller.abort();
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-store, no-transform',
				'X-Accel-Buffering': 'no',
				...rateLimitHeaders(limit)
			}
		});
	} catch (error) {
		if (error instanceof ApiError) {
			throw new ApiError(error.code, error.message, {
				fields: error.fields,
				headers: { ...error.headers, ...rateLimitHeaders(limit) }
			});
		}
		throw error;
	}
});
