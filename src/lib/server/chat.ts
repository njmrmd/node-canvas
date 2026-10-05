import {
	MAX_MESSAGES,
	MAX_MESSAGE_CHARS,
	MAX_SYSTEM_CHARS,
	MAX_TOTAL_CHARS
} from '../shared/chat-limits';
import type { ChatMessage } from '../shared/chat-types';
import { findModel, type ModelSpec } from '../shared/models';
import { ApiError } from './api-error';

/** Validates POST /api/chat. The client decides the content of a branch, never its size. */
export function parseChatBody(body: Record<string, unknown>): {
	model: ModelSpec;
	messages: ChatMessage[];
	system?: string;
} {
	const model = findModel(body.model);
	if (!model) throw new ApiError('unsupported_model', 'That model is not available.');
	const system =
		typeof body.system === 'string' && body.system.trim() !== ''
			? body.system.slice(0, MAX_SYSTEM_CHARS)
			: undefined;
	return { model, messages: parseMessages(body.messages), ...(system ? { system } : {}) };
}

function parseMessages(value: unknown): ChatMessage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new ApiError('invalid_request', 'Send at least one message.', {
			fields: { messages: 'Send at least one message.' }
		});
	}
	if (value.length > MAX_MESSAGES) {
		throw new ApiError(
			'invalid_request',
			`This branch is too long — it holds more than ${MAX_MESSAGES} messages.`
		);
	}
	let total = 0;
	const messages: ChatMessage[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null)
			throw new ApiError('invalid_request', 'A message was malformed.');
		const { role, content } = entry as Record<string, unknown>;
		// An allowlist of two: a client that could send "system" could rewrite the instructions.
		if (role !== 'user' && role !== 'assistant')
			throw new ApiError('invalid_request', 'A message had an unknown role.');
		if (typeof content !== 'string' || content.trim() === '')
			throw new ApiError('invalid_request', 'A message was empty.');
		if (content.length > MAX_MESSAGE_CHARS)
			throw new ApiError('invalid_request', 'One message is too long.');
		total += content.length;
		if (total > MAX_TOTAL_CHARS)
			throw new ApiError(
				'invalid_request',
				'This branch is too long to send. Start a new node from further up.'
			);
		messages.push({ role, content });
	}
	if (messages[0].role !== 'user')
		throw new ApiError('invalid_request', 'A conversation has to start with a message from you.');
	return messages;
}
