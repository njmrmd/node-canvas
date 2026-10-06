import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveShortcut, SHORTCUT_ROWS, type KeyInput } from './shortcuts';

type Mods = Partial<Pick<KeyInput, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>>;
const press = (key: string, mods: Mods = {}): KeyInput => ({
	key,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	...mods
});
const onCard = { typing: false, onCard: true };
const anywhere = { typing: false, onCard: false };

describe('SHORTCUT_ROWS', () => {
	it("lists the old sheet's 21 shortcuts, in its order and wording", () => {
		assert.equal(SHORTCUT_ROWS.length, 21);
		assert.deepEqual(SHORTCUT_ROWS[0], { keys: '↑ / ↓ / ← / →', does: 'Move focus to parent / first child / sibling' });
		assert.deepEqual(SHORTCUT_ROWS[8], { keys: 'Delete / Backspace', does: 'Delete focused node + subtree' });
		assert.deepEqual(SHORTCUT_ROWS[20], { keys: '?', does: 'This sheet' });
	});
});

describe('resolveShortcut', () => {
	it('resolves every row of the sheet', () => {
		const cases: [KeyInput, typeof onCard, unknown][] = [
			[press('ArrowUp'), onCard, { kind: 'focus', move: 'parent' }],
			[press('ArrowDown'), onCard, { kind: 'focus', move: 'child' }],
			[press('ArrowLeft'), onCard, { kind: 'focus', move: 'prev' }],
			[press('ArrowRight'), onCard, { kind: 'focus', move: 'next' }],
			[press('Home'), anywhere, { kind: 'focus', move: 'first' }],
			[press('End'), anywhere, { kind: 'focus', move: 'last' }],
			[press('Enter'), onCard, { kind: 'bind' }],
			[press('b'), onCard, { kind: 'branch' }],
			[press('R', { shiftKey: false }), onCard, { kind: 'regenerate' }],
			[press('c'), onCard, { kind: 'toggleCollapsed' }],
			[press('m'), onCard, { kind: 'toggleBody' }],
			[press('ArrowRight', { metaKey: true, altKey: true }), onCard, { kind: 'resize', dw: 8, dh: 0 }],
			[press('ArrowUp', { ctrlKey: true, altKey: true, shiftKey: true }), onCard, { kind: 'resize', dw: 0, dh: -32 }],
			[press('Delete'), onCard, { kind: 'delete' }],
			[press('Backspace'), onCard, { kind: 'delete' }],
			[press('Escape'), onCard, { kind: 'stop' }],
			[press('z', { metaKey: true }), anywhere, { kind: 'undo' }],
			[press('z', { ctrlKey: true }), anywhere, { kind: 'undo' }],
			[press('+', { shiftKey: true }), anywhere, { kind: 'zoomIn' }],
			[press('='), anywhere, { kind: 'zoomIn' }],
			[press('-'), anywhere, { kind: 'zoomOut' }],
			[press('0'), anywhere, { kind: 'fit' }],
			[press('1'), anywhere, { kind: 'zoom100' }],
			[press('ArrowLeft', { altKey: true }), onCard, { kind: 'nudge', dx: -16, dy: 0 }],
			[press('ArrowDown', { altKey: true, shiftKey: true }), onCard, { kind: 'nudge', dx: 0, dy: 64 }],
			[press('l'), anywhere, { kind: 'tidy' }],
			[press('f'), anywhere, { kind: 'focusPath' }],
			[press('t'), anywhere, { kind: 'transcript' }],
			[press('?', { shiftKey: true }), anywhere, { kind: 'shortcuts' }]
		];
		for (const [key, ctx, command] of cases) {
			assert.deepEqual(resolveShortcut(key, ctx), command, JSON.stringify(key));
		}
	});

	it('nothing fires while typing', () => {
		const typing = { typing: true, onCard: true };
		for (const key of [press('t'), press('f'), press('0'), press('l'), press('Backspace'), press('ArrowUp'), press('z', { metaKey: true }), press('?', { shiftKey: true })]) {
			assert.equal(resolveShortcut(key, typing), null, key.key);
		}
	});

	it('card commands need a focused card; moves and canvas commands do not', () => {
		for (const key of [press('b'), press('r'), press('c'), press('m'), press('Delete'), press('Escape'), press('Enter'), press('ArrowLeft', { altKey: true }), press('ArrowLeft', { metaKey: true, altKey: true })]) {
			assert.equal(resolveShortcut(key, anywhere), null, JSON.stringify(key));
		}
		assert.deepEqual(resolveShortcut(press('ArrowUp'), anywhere), { kind: 'focus', move: 'parent' });
		assert.deepEqual(resolveShortcut(press('t'), anywhere), { kind: 'transcript' });
	});

	it('leaves modified letters and digits to the browser', () => {
		for (const key of [press('r', { metaKey: true }), press('t', { ctrlKey: true }), press('f', { altKey: true }), press('0', { metaKey: true }), press('1', { ctrlKey: true }), press('z', { metaKey: true, shiftKey: true }), press('B', { shiftKey: true })]) {
			assert.equal(resolveShortcut(key, onCard), null, JSON.stringify(key));
		}
	});
});
