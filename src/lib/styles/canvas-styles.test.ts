import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const DIR = 'src/lib/components/canvas';

/** Each canvas component's declarations: the inside of every rule in its <style> block, comments removed. The tests run from the repository root. */
const styles = readdirSync(DIR)
	.filter((file) => file.endsWith('.svelte'))
	.map((file) => {
		const source = readFileSync(join(DIR, file), 'utf8');
		const block = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
		const declarations = (block.replace(/\/\*[\s\S]*?\*\//g, '').match(/\{[^{}]*\}/g) ?? []).join('\n');
		return { file, declarations };
	});

/** What must come from a token instead. Layout sizes (max-height, a handle's width) are not control heights. */
const BANNED: [RegExp, string][] = [
	[/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, 'a colour function'],
	[/#[0-9a-fA-F]{3,8}\b/, 'a hex colour'],
	[/font-weight:\s*(\d|bold)/, 'a literal font-weight'],
	[/\bmin-height:\s*[1-9]\d*px/, 'a pixel control height']
];

describe('canvas component styles', () => {
	it('take colours, weights and control heights from tokens', () => {
		const violations = styles.flatMap(({ file, declarations }) =>
			BANNED.filter(([pattern]) => pattern.test(declarations)).map(([, what]) => `${file} uses ${what}`)
		);
		assert.deepEqual(violations, []);
	});

	it('finds a <style> block in every component that has one', () => {
		const withStyle = readdirSync(DIR).filter((file) => file.endsWith('.svelte') && /<style[\s>]/.test(readFileSync(join(DIR, file), 'utf8')));
		for (const file of withStyle) {
			assert.ok(styles.find((s) => s.file === file)!.declarations.length > 0, `${file}'s style block was not read`);
		}
	});
});
