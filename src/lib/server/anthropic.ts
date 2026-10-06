import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatStreamEvent } from '../shared/chat-types';
import type { ModelSpec } from '../shared/models';
import { ApiError } from './api-error';

const VALIDATE_TIMEOUT_MS = 20_000;

/** ANTHROPIC_BASE_URL is for tests only (the fake API); unset in every deployment. */
export function clientFor(apiKey: string, timeoutMs: number): Anthropic {
	return new Anthropic({
		apiKey,
		timeout: timeoutMs,
		maxRetries: 1,
		baseURL: process.env.ANTHROPIC_BASE_URL || undefined
	});
}

/**
 * SDK error → our envelope. The provider's message can echo request content,
 * so it is never forwarded or logged; the class label and status are.
 */
export function toApiError(error: unknown, context: 'validate' | 'chat'): ApiError {
	const status = error instanceof Anthropic.APIError ? error.status : undefined;
	const log = (label: string) => console.error(`[anthropic] ${context}: ${label}, status=${status}`);

	if (error instanceof Anthropic.AuthenticationError) {
		log('AuthenticationError');
		return new ApiError(
			'invalid_api_key',
			'Anthropic rejected that key. Check that you copied it in full and that it is still active.'
		);
	}
	if (error instanceof Anthropic.PermissionDeniedError) {
		log('PermissionDeniedError');
		return new ApiError(
			'invalid_api_key',
			"That key does not have permission to use the Anthropic API. Check its scopes or your account's billing status."
		);
	}
	if (error instanceof Anthropic.RateLimitError) {
		log('RateLimitError');
		return new ApiError('provider_unavailable', 'Anthropic is rate limiting this key right now. Wait a moment and try again.');
	}
	if (error instanceof Anthropic.BadRequestError) {
		log('BadRequestError');
		return context === 'validate'
			? new ApiError(
					'invalid_api_key',
					'Anthropic rejected that key as malformed. Check that you pasted a full API key from console.anthropic.com.'
				)
			: new ApiError('provider_unavailable', 'Anthropic rejected this request. Try a shorter message or a different model.');
	}
	if (error instanceof Anthropic.APIConnectionError) {
		log('APIConnectionError');
		return new ApiError('provider_unavailable', 'Could not reach Anthropic. Please try again.');
	}
	if (error instanceof Anthropic.APIError) {
		log('APIError');
		return new ApiError('provider_unavailable', 'Anthropic returned an error. Please try again.');
	}
	log(error instanceof Error ? `non-SDK ${error.name}` : 'non-Error throw');
	return new ApiError('provider_unavailable', 'The model provider could not be reached. Please try again.');
}

/** An authenticated, token-free GET: proves the key works before we store it. */
export async function validateApiKey(apiKey: string): Promise<void> {
	try {
		await clientFor(apiKey, VALIDATE_TIMEOUT_MS).models.list({ limit: 1 });
	} catch (error) {
		throw toApiError(error, 'validate');
	}
}

const CHAT_TIMEOUT_MS = 120_000;
const MAX_TOKENS = 64_000;
const DECLINED = 'The model declined to answer this request. Try rephrasing it.';

/**
 * Streams one reply as our own transport-neutral events. Thinking summaries
 * are on wherever the model takes adaptive thinking, so the card has
 * something real to show while the model works. Refusals are retried on
 * Anthropic's recommended fallback on the same stream; text already sent
 * stays valid, so the relay needs no special handling for it.
 */
export async function* streamChat(options: {
	apiKey: string;
	model: ModelSpec;
	system?: string;
	messages: ChatMessage[];
	signal: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
	const { model } = options;
	const params = {
		model: model.id,
		max_tokens: MAX_TOKENS,
		...(model.thinking === 'adaptive'
			? { thinking: { type: 'adaptive', display: 'summarized' } }
			: {}),
		...(model.effort ? { output_config: { effort: model.effort } } : {}),
		...(model.fallbacks
			? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
			: {}),
		...(options.system ? { system: options.system } : {}),
		messages: options.messages.map((m) => ({ role: m.role, content: m.content }))
	};
	const client = clientFor(options.apiKey, CHAT_TIMEOUT_MS);
	try {
		const stream = client.beta.messages.stream(
			params as unknown as Parameters<typeof client.beta.messages.stream>[0],
			{ signal: options.signal }
		);
		for await (const event of stream) {
			if (event.type === 'message_start') {
				yield { type: 'ping' };
				continue;
			}
			if (event.type !== 'content_block_delta') continue;
			if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
			else if (event.delta.type === 'thinking_delta')
				yield { type: 'thinking', text: event.delta.thinking };
		}
		const final = await stream.finalMessage();
		// A refusal is an HTTP 200 with stop_reason "refusal": check before trusting content.
		if (final.stop_reason === 'refusal') {
			yield { type: 'error', code: 'model_declined', message: DECLINED };
			return;
		}
		yield {
			type: 'done',
			stopReason: final.stop_reason ?? 'end_turn',
			usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens }
		};
	} catch (error) {
		if (options.signal.aborted) return; // the browser went away or pressed Stop
		const apiError = toApiError(error, 'chat');
		yield { type: 'error', code: apiError.code, message: apiError.message };
	}
}
