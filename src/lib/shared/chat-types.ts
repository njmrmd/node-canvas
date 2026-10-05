import type { ErrorCode } from './error-codes';

/** Transport-neutral shapes between the provider and the browser. Nothing provider-shaped crosses. */
export type ChatRole = 'user' | 'assistant';

export type ChatMessage = { role: ChatRole; content: string };

export type ChatStreamEvent =
	/** An increment of the visible answer. */
	| { type: 'text'; text: string }
	/** An increment of the summarized reasoning. Never the answer. */
	| { type: 'thinking'; text: string }
	/** Terminal success. */
	| { type: 'done'; stopReason: string; usage: { inputTokens: number; outputTokens: number } }
	/** Terminal failure, mid-stream. Same codes as the JSON API. */
	| { type: 'error'; code: ErrorCode; message: string };
