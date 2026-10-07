import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { wire } from '../../../tests/support/wire';
import type { NodeWire } from '../canvas/node-wire';
import { ApiError } from './api-error';
import { decodeCursor, encodeCursor, isUuid, parseSaveBody, takePage } from './nodes';

const rejects = (body: unknown) =>
	assert.throws(() => parseSaveBody(body as Record<string, unknown>), (e: unknown) => e instanceof ApiError && e.code === 'invalid_request');

describe('parseSaveBody', () => {
	it('accepts nodes and an optional view', () => {
		const n = wire();
		const parsed = parseSaveBody({ upserts: [n], view: { viewport: { x: 1, y: 2, zoom: 1 }, targetNodeId: n.id } });
		assert.deepEqual(parsed.upserts, [n]);
		assert.deepEqual(parsed.view, { viewport: { x: 1, y: 2, zoom: 1 }, targetNodeId: n.id });
		assert.equal(parseSaveBody({ upserts: [] }).view, null);
	});

	it('rejects malformed ids, statuses, numbers and shapes', () => {
		rejects({ upserts: 'x' });
		rejects({ upserts: [wire({ id: 'n_123' })] });
		rejects({ upserts: [wire({ parentId: 'nope' })] });
		rejects({ upserts: [wire({ status: 'queued' as NodeWire['status'] })] });
		rejects({ upserts: [wire({ x: Number.NaN })] });
		rejects({ upserts: [wire({ positionMode: 'free' as NodeWire['positionMode'] })] });
		rejects({ upserts: [wire({ width: 0 })] });
		rejects({ upserts: [], view: { viewport: { x: 0, y: 0 }, targetNodeId: null } });
	});

	it('enforces the batch and text caps', () => {
		rejects({ upserts: Array.from({ length: 201 }, () => wire()) });
		rejects({ upserts: [wire({ prompt: 'x'.repeat(100_001) })] });
		rejects({ upserts: [wire({ response: 'x'.repeat(400_001) })] });
		rejects({ upserts: [wire({ thinking: 'x'.repeat(400_001) })] });
		assert.equal(parseSaveBody({ upserts: [wire({ response: 'x'.repeat(390_000) })] }).upserts.length, 1);
	});

	it('sanitises NUL and lone surrogates in every text field', () => {
		const dirty = 'a\u0000b\uD800c\uDFFFd😀';
		const clean = 'a\uFFFDb\uFFFDc\uFFFDd😀';
		const [n] = parseSaveBody({
			upserts: [
				wire({
					prompt: dirty,
					response: dirty,
					thinking: dirty,
					model: dirty,
					status: 'error',
					error: { code: 'internal_error', message: dirty }
				})
			]
		}).upserts;
		assert.equal(n.prompt, clean);
		assert.equal(n.response, clean);
		assert.equal(n.thinking, clean);
		assert.equal(n.model, clean);
		assert.equal(n.error?.message, clean);
	});

	it('recognises UUIDs', () => {
		assert.equal(isUuid(randomUUID()), true);
		assert.equal(isUuid('not-a-uuid'), false);
	});
});

describe('canvas load pages', () => {
	it('round-trips a cursor and refuses a malformed one', () => {
		const cursor = { createdAt: '2026-10-06T12:34:56.123456Z', id: randomUUID() };
		assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
		for (const bad of ['', 'nope', `2026-10-06T12:34:56Z_${cursor.id}`, `${cursor.createdAt}_not-a-uuid`, `${cursor.createdAt}${cursor.id}`]) {
			assert.equal(decodeCursor(bad), null, bad);
		}
	});

	it('takes rows while they fit the budget, and always at least one', () => {
		const rows = [{ bytes: 100 }, { bytes: 100 }, { bytes: 5000 }, { bytes: 1 }];
		assert.equal(takePage(rows, 1500).length, 2); // 2 × (100 + 512 overhead) fit; the 5000 does not
		assert.equal(takePage(rows.slice(2), 1500).length, 1); // a row bigger than the budget goes alone
		assert.equal(takePage([], 1500).length, 0);
	});
});
