import type { FocusMove } from './navigation';

/** What a key press asks the canvas to do. */
export type Command =
	| { kind: 'focus'; move: FocusMove }
	| { kind: 'bind' }
	| { kind: 'branch' }
	| { kind: 'regenerate' }
	| { kind: 'toggleCollapsed' }
	| { kind: 'toggleBody' }
	| { kind: 'resize'; dw: number; dh: number }
	| { kind: 'nudge'; dx: number; dy: number }
	| { kind: 'delete' }
	| { kind: 'stop' }
	| { kind: 'undo' }
	| { kind: 'zoomIn' }
	| { kind: 'zoomOut' }
	| { kind: 'fit' }
	| { kind: 'zoom100' }
	| { kind: 'tidy' }
	| { kind: 'focusPath' }
	| { kind: 'transcript' }
	| { kind: 'shortcuts' };

export type KeyInput = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

export type KeyContext = {
	/** Focus is in an input, textarea, select or contenteditable: the keys belong to it. */
	typing: boolean;
	/** The key went to a card itself (an `article[data-node-id]` has DOM focus). */
	onCard: boolean;
};

export const NUDGE_PX = 16;
export const NUDGE_FAR_PX = 64;
export const RESIZE_PX = 8;
export const RESIZE_FAR_PX = 32;

/** The old app's sheet, verbatim and in order (shortcuts-sheet.tsx at c215512). Every row works. */
export const SHORTCUT_ROWS: readonly { keys: string; does: string }[] = [
	{ keys: '↑ / ↓ / ← / →', does: 'Move focus to parent / first child / sibling' },
	{ keys: 'Home / End', does: 'Focus root / most recent leaf' },
	{ keys: 'Enter (node focused)', does: 'Focus the composer, bound to the focused node' },
	{ keys: 'B', does: 'Branch from focused node' },
	{ keys: 'R', does: 'Regenerate focused node' },
	{ keys: 'C', does: "Collapse / expand focused node's subtree" },
	{ keys: 'M', does: "Collapse / expand focused node's own body to one line" },
	{ keys: 'Cmd/Ctrl + Alt + arrows', does: 'Resize focused node' },
	{ keys: 'Delete / Backspace', does: 'Delete focused node + subtree' },
	{ keys: 'Esc', does: 'Stop generation (node focused, streaming)' },
	{ keys: 'Enter (in composer)', does: 'Send (Shift + Enter for a new line)' },
	{ keys: 'Cmd/Ctrl + Z', does: 'Undo last delete' },
	{ keys: '+ / −', does: 'Zoom in / out' },
	{ keys: '0', does: 'Zoom to fit' },
	{ keys: '1', does: 'Zoom to 100%' },
	{ keys: 'Alt + arrows', does: 'Move focused node 16px' },
	{ keys: 'Shift + Alt + arrows', does: 'Move focused node 64px' },
	{ keys: 'L', does: 'Tidy' },
	{ keys: 'F', does: 'Toggle focus-path' },
	{ keys: 'T', does: 'Toggle linear view' },
	{ keys: '?', does: 'This sheet' }
];

const ARROWS: Record<string, readonly [number, number]> = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0]
};
const MOVES: Record<string, FocusMove> = {
	ArrowUp: 'parent',
	ArrowDown: 'child',
	ArrowLeft: 'prev',
	ArrowRight: 'next',
	Home: 'first',
	End: 'last'
};

/**
 * The command a key press means, or null to let the browser have it. Nothing fires while typing.
 * Card commands need the key to have gone to a card. Letters and digits ignore Cmd, Ctrl and Alt,
 * so the browser keeps its own shortcuts (Cmd+R reloads; it never regenerates).
 */
export function resolveShortcut(e: KeyInput, ctx: KeyContext): Command | null {
	if (ctx.typing) return null;
	const mod = e.metaKey || e.ctrlKey;
	const arrow = ARROWS[e.key];
	if (arrow) {
		const [x, y] = arrow;
		if (mod && e.altKey) {
			const step = e.shiftKey ? RESIZE_FAR_PX : RESIZE_PX;
			return ctx.onCard ? { kind: 'resize', dw: x * step, dh: y * step } : null;
		}
		if (e.altKey) {
			const step = e.shiftKey ? NUDGE_FAR_PX : NUDGE_PX;
			return ctx.onCard ? { kind: 'nudge', dx: x * step, dy: y * step } : null;
		}
		if (mod || e.shiftKey) return null;
		return { kind: 'focus', move: MOVES[e.key] };
	}
	if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') return { kind: 'undo' };
	if (mod || e.altKey) return null;
	// No Cmd, Ctrl or Alt from here. Shift only where the key itself needs it (?, +, _).
	switch (e.key) {
		case 'Home':
		case 'End':
			return e.shiftKey ? null : { kind: 'focus', move: MOVES[e.key] };
		case 'Enter':
			return ctx.onCard && !e.shiftKey ? { kind: 'bind' } : null;
		case 'Delete':
		case 'Backspace':
			return ctx.onCard ? { kind: 'delete' } : null;
		case 'Escape':
			return ctx.onCard ? { kind: 'stop' } : null;
		case '?':
			return { kind: 'shortcuts' };
		case '+':
		case '=':
			return { kind: 'zoomIn' };
		case '-':
		case '_':
			return { kind: 'zoomOut' };
		case '0':
			return { kind: 'fit' };
		case '1':
			return { kind: 'zoom100' };
	}
	if (e.shiftKey) return null;
	switch (e.key.toLowerCase()) {
		case 'b':
			return ctx.onCard ? { kind: 'branch' } : null;
		case 'r':
			return ctx.onCard ? { kind: 'regenerate' } : null;
		case 'c':
			return ctx.onCard ? { kind: 'toggleCollapsed' } : null;
		case 'm':
			return ctx.onCard ? { kind: 'toggleBody' } : null;
		case 'l':
			return { kind: 'tidy' };
		case 'f':
			return { kind: 'focusPath' };
		case 't':
			return { kind: 'transcript' };
	}
	return null;
}
