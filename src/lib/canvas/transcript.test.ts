import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transcriptText } from './transcript';

describe('transcriptText', () => {
	it('writes each exchange as You / Assistant, separated by a rule', () => {
		assert.equal(
			transcriptText([
				{ prompt: 'one?', response: 'One.' },
				{ prompt: 'two?', response: 'Two.' }
			]),
			'You: one?\n\nAssistant: One.\n\n---\n\nYou: two?\n\nAssistant: Two.'
		);
	});

	it('is empty for an empty path', () => {
		assert.equal(transcriptText([]), '');
	});

	it('never includes thinking', () => {
		const node = { prompt: 'q', response: 'a', thinking: 'secret reasoning' };
		assert.equal(transcriptText([node]).includes('secret'), false);
	});
});
