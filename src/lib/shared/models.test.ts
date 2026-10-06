import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MODEL_ID, findModel, MODELS } from './models';

describe('models', () => {
	it('defaults to Claude Opus 5.5', () => {
		assert.equal(DEFAULT_MODEL_ID, 'claude-opus-5-5');
		assert.equal(findModel(DEFAULT_MODEL_ID)?.label, 'Claude Opus 5.5');
	});

	it('offers exactly the three supported models, with exact ids', () => {
		assert.deepEqual(
			MODELS.map((m) => m.id),
			['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']
		);
	});

	it('enables adaptive thinking and fallbacks only where the model accepts them', () => {
		for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
			const m = findModel(id)!;
			assert.equal(m.thinking, 'adaptive');
			assert.equal(m.effort, 'medium');
			assert.equal(m.fallbacks, true);
		}
		const haiku = findModel('claude-haiku-4-5')!;
		assert.equal(haiku.thinking, 'none');
		assert.equal(haiku.effort, null);
		assert.equal(haiku.fallbacks, false);
	});

	it('rejects anything else', () => {
		for (const bad of ['claude-opus-5', 'gpt-5', '', null, 42, undefined]) {
			assert.equal(findModel(bad), null, String(bad));
		}
	});
});
