import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDuration, secondsUntil } from './format';

describe('formatDuration', () => {
	it('rounds up to whole minutes under an hour and a half', () => {
		assert.equal(formatDuration(0), 'under a minute');
		assert.equal(formatDuration(45), 'under a minute');
		assert.equal(formatDuration(61), '2 minutes');
		assert.equal(formatDuration(60), '1 minute');
		assert.equal(formatDuration(3599), '60 minutes');
	});

	it('switches to hours past ninety minutes', () => {
		assert.equal(formatDuration(5400), '90 minutes');
		assert.equal(formatDuration(5401), '2 hours');
	});
});

describe('secondsUntil', () => {
	it('counts whole seconds up to the reset, rounding up', () => {
		assert.equal(secondsUntil(10_000, 0), 10);
		assert.equal(secondsUntil(10_000, 9_001), 1);
	});

	it('is zero once the reset has passed', () => {
		assert.equal(secondsUntil(10_000, 10_000), 0);
		assert.equal(secondsUntil(10_000, 20_000), 0);
	});
});
