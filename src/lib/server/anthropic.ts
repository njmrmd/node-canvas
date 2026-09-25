import Anthropic from '@anthropic-ai/sdk';
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
