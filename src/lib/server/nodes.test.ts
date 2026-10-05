import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { wire } from '../../../tests/support/wire';
import type { NodeWire } from '../canvas/node-wire';
import { ApiError } from './api-error';
import { isUuid, parseSaveBody } from './nodes';

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

	it('recognises UUIDs', () => {
		assert.equal(isUuid(randomUUID()), true);
		assert.equal(isUuid('not-a-uuid'), false);
	});
});
