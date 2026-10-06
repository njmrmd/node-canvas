import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { focusOn, rectInView, ZOOM_MAX, ZOOM_MIN, zoomAt } from './viewport';

describe('zoomAt', () => {
	it('keeps the canvas point under the anchor where it was', () => {
		const vp = { x: 100, y: 50, zoom: 1 };
		const anchor = { x: 300, y: 250 };
		const next = zoomAt(vp, 2, anchor);
		assert.equal((anchor.x - next.x) / next.zoom, (anchor.x - vp.x) / vp.zoom);
		assert.equal((anchor.y - next.y) / next.zoom, (anchor.y - vp.y) / vp.zoom);
	});

	it('clamps to the zoom range', () => {
		assert.equal(zoomAt({ x: 0, y: 0, zoom: 1 }, 9, { x: 0, y: 0 }).zoom, ZOOM_MAX);
		assert.equal(zoomAt({ x: 0, y: 0, zoom: 1 }, 0.01, { x: 0, y: 0 }).zoom, ZOOM_MIN);
	});
});

describe('rectInView and focusOn', () => {
	it('brings an off-screen rect into view without changing the zoom', () => {
		const size = { width: 1000, height: 800 };
		const rect = { x: 5000, y: 5000, width: 200, height: 100 };
		assert.equal(rectInView({ x: 0, y: 0, zoom: 0.5 }, rect, size), false);
		const vp = focusOn(rect, size, 0.5, 0.5);
		assert.equal(vp.zoom, 0.5);
		assert.equal(rectInView(vp, rect, size), true);
	});
});
