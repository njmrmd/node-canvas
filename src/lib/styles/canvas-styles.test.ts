import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const DIR = 'src/lib/components/canvas';
/** Each canvas component's `<style>` block (the tests run from the repository root). */
const styles = readdirSync(DIR)
	.filter((file) => file.endsWith('.svelte'))
	.map((file) => {
		const source = readFileSync(join(DIR, file), 'utf8');
		const start = source.indexOf('<style>');
		return { file, css: start === -1 ? '' : source.slice(start) };
	});

describe('canvas component styles', () => {
	it('take colours, weights and control heights from tokens', () => {
		const banned: [RegExp, string][] = [
			[/\brgba?\(/, 'an rgb() colour'],
			[/:\s*#[0-9a-fA-F]{3,8}\b/, 'a hex colour'],
			[/font-weight:\s*\d/, 'a numeric font-weight'],
			[/min-height:\s*[1-9]\d*px/, 'a pixel control height']
		];
		for (const { file, css } of styles) {
			for (const [pattern, what] of banned) assert.doesNotMatch(css, pattern, `${file} uses ${what}`);
		}
	});
});
