/**
 * Caps on what one chat request may carry.
 *
 * Both sides need them: the server refuses an over-long branch (`src/lib/server/chat.ts`), and the canvas
 * catches the same thing before spending a round trip on it. One copy, so the two can never disagree. The
 * server is still the authority: a client that skips these checks is simply refused.
 *
 * No imports: this module is shared by the browser bundle and the server.
 */

/** Messages in a single branch. */
export const MAX_MESSAGES = 100;

/** Characters in any one message. */
export const MAX_MESSAGE_CHARS = 100_000;

/** Characters across every message in the request. */
export const MAX_TOTAL_CHARS = 400_000;

/** Characters in the system prompt. */
export const MAX_SYSTEM_CHARS = 10_000;

/**
 * Bytes in the request body. Sized so the character caps above are the ones
 * that actually bind: 410k characters at up to 3 UTF-8 bytes each is ~1.2 MB,
 * plus JSON escaping and envelope. The old shared 256 KB default refused a
 * branch well before it reached `MAX_TOTAL_CHARS`.
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
