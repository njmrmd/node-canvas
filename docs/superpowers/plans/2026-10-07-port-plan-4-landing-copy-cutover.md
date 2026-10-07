# Port Plan 4 of 4: landing page, copy pass, cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give node-canvas a real front door and a link card that explain the product. Make the canvas's copy and states say true things. Hand the human a cutover runbook that retires node-canvas-chat.

**Architecture:**
- **Landing page.** `/` is ported from the old app's landing page: a hero for strangers and a "Welcome back" frame for signed-in people.
- **The drawing.** The three-card drawing comes from one geometry module. Both the Svelte component and the script that renders `static/og.png` draw from it.
- **Link-card tags.** The root layout carries the Open Graph and Twitter tags, built from the request's own origin.
- **Copy pass.** It changes `src/lib/canvas/copy.ts`, `errors.ts` and the components that render those strings.
- **Cutover.** It stays a human runbook: every step is a production or account action.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, `node:test` + tsx, Playwright 1.63 (pinned), `@xyflow/svelte` 1.7.0.

**Spec:** `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`. Open findings: `docs/superpowers/notes/2026-10-06-plan-2-followups.md`.

**Branch:** `plan-4-landing-copy-cutover`, stacked on `plan-3-canvas-features` (PR #2, not yet merged when this plan was written).

## Global Constraints

- SvelteKit 2 + Svelte 5 runes only: no stores API, `onclick` not `on:click`, `$props()`, `$state`, `$derived`, `$effect`. Read `AGENTS.md` before writing code.
- Desktop only: below 900 px wide (`@media (width < 900px)`), the root layout shows the desktop notice instead of the page. Plan 4 makes one exception, on `/` (Task 1).
- Copy tone: state what happened and what to do next. No exclamation marks, no apologies, no "Oops", and never blame the person for an error the system caused.
  - Canvas strings live in `src/lib/canvas/copy.ts`.
  - Page strings live in `src/lib/copy/*.ts`.
  - No string literals for UI text in components.
- Styling: Svelte `<style>` blocks and CSS custom-property tokens (`src/lib/styles/tokens.css`, `src/lib/styles/canvas-tokens.css`). No Tailwind. No new colour literals outside the token files.
- Security headers and CSP come from `kit.csp`, with no `unsafe-inline` scripts. No inline `<script>` in pages.
- Links that leave the site: `target="_blank"` with `rel="external noopener noreferrer"`.
- Never log keys, tokens, passwords, prompts, responses, emails or error messages.
- Gate before every commit: `pnpm check && pnpm lint && pnpm test`. Run `pnpm test:e2e` when the task's run step lists it. `pnpm check` must report 0 errors and 0 warnings.
- Commits: small and conventional, ending with `Co-Authored-By: <the model you are> <noreply@anthropic.com>`.
- No production side effects from an implementer: no pushes, Vercel settings, repository archiving or real-key calls.

## Review Focus

1. **A shared link unfurls.** A crawler fetching `/` gets an absolute `og:image` on the page's own origin that answers 200 `image/png` at 1200 × 630, plus a title and a description. Owner: Task 2 (test: "a shared link unfurls…").
2. **A phone visitor at `/` can read the pitch.** The landing page is the one page a stranger opens from a shared link, often on a phone. It stays readable below 900 px, with the desktop note above it. Owner: Task 1 (test: "on a phone-width window…").
3. **A session that ends mid-canvas says so.** A send then shows "You've been signed out" with a Sign in link back to `/canvas`, not "Something went wrong on our side." Owner: Task 3 (test: "a send after the session has ended…").
4. **A stalled canvas load offers Retry, and Retry starts over.** The stuck request is aborted and a fresh load runs. Owner: Task 4 (test: "a stalled canvas load…").
5. **The limit banner's time stays true while a tab sits open.** Owner: Task 5 (test: "the limit banner counts down…").

---

### Task 1: The landing page

The old app's front door, ported (`src/app/page.tsx` and `src/components/conversation-graph.tsx` in `njmrmd/node-canvas-chat`):
- **A stranger** sees an eyebrow, the headline, a lede, the three-card drawing, "Create an account" and "Sign in", a note about the key, "How it works" in three steps, and the open-source line.
- **Someone signed in** gets "Welcome back." in the `Shell` frame, with "Open the canvas" and "Manage your key". They are not pitched to a second time.

**Narrow windows.** `/` stays readable below 900 px, with a compact desktop note above it. Every other route keeps the full notice instead of the page.

**Copy.** The desktop notice's body loses "Your canvas is saved and waiting there". The notice also shows to people with no canvas.

**Files:**
- Create: `src/lib/landing/drawing.ts`, `src/lib/landing/drawing.test.ts`
- Create: `src/lib/copy/landing.ts`, `src/lib/copy/landing.test.ts`
- Create: `src/lib/components/ConversationGraph.svelte`
- Create: `tests/e2e/landing.spec.ts`
- Modify: `src/routes/+page.svelte` (full replacement below), `src/routes/+layout.svelte`, `src/lib/components/DesktopOnlyNotice.svelte` (full replacement below), `src/lib/styles/tokens.css`, `src/lib/canvas/copy.ts`

**Interfaces:**
- Consumes: `Shell` (`src/lib/components/Shell.svelte`); the root layout's `data.user`, which `+layout.server.ts` returns as `{ email } | null`; `copy('desktop.title' | 'desktop.body')`.
- **Produces, from `src/lib/landing/drawing.ts`:**
  - `VIEWBOX`, `CARD`, `CARDS`, `EDGES`, `HANDLE`;
  - `type Card`, `type DrawingColors`;
  - `cardShapes(card: Card)`;
  - `drawingSvg(colors: DrawingColors, size: { width: number; height: number }): string`.
- **Produces, from `src/lib/copy/landing.ts`:** `LANDING_COPY` (including `description`, `ogTitle`, `ogLede`, `ogImageAlt`, which Task 2 uses), `ANTHROPIC_KEYS_URL` and `SOURCE_URL`.
- **Produces:** `DesktopOnlyNotice` takes `compact?: boolean`.
- **Produces, new tokens in `tokens.css`:** `--font-mono`, `--text-xs`, `--text-3xl`, `--space-12`.

- [ ] **Step 1: Write the failing unit tests**

`src/lib/landing/drawing.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CARD, CARDS, cardShapes, drawingSvg, EDGES, HANDLE, VIEWBOX } from './drawing';

describe('the landing drawing', () => {
	it('keeps every card inside the grid, and every line inside its card', () => {
		for (const card of CARDS) {
			assert.ok(card.x >= 0 && card.x + CARD.width <= VIEWBOX.width, `card at x ${card.x}`);
			assert.ok(card.y >= 0 && card.y + CARD.height <= VIEWBOX.height, `card at y ${card.y}`);
			const { prompt, replies } = cardShapes(card);
			for (const line of [prompt, ...replies]) {
				assert.ok(line.x + line.width <= card.x + CARD.width - CARD.pad, `a line overflows the card at x ${card.x}`);
			}
		}
	});

	it('joins the trunk to the parent and each branch to a child, at their centres', () => {
		const [parent, left, right] = CARDS;
		const centre = (card: (typeof CARDS)[number]) => card.x + CARD.width / 2;
		assert.equal(EDGES[0], `M${centre(parent)} ${parent.y + CARD.height} V72`);
		assert.ok(EDGES[1].endsWith(`${centre(left)} ${left.y}`), EDGES[1]);
		assert.ok(EDGES[2].endsWith(`${centre(right)} ${right.y}`), EDGES[2]);
		assert.equal(HANDLE.cx, centre(parent));
	});

	it('draws three cards, three edges and the branch handle as standalone SVG', () => {
		const svg = drawingSvg({ background: '#fff', hairline: '#eee', muted: '#777', foreground: '#111' }, { width: 432, height: 240 });
		assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 360 200" width="432" height="240">/);
		assert.equal(svg.match(/<rect /g)?.length, 12, 'a frame, a prompt line and two reply lines per card');
		assert.equal(svg.match(/<path /g)?.length, 4, 'three edges and the plus');
		assert.equal(svg.match(/<circle /g)?.length, 1);
		assert.ok(svg.endsWith('</svg>'));
	});
});
```

`src/lib/copy/landing.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANTHROPIC_KEYS_URL, LANDING_COPY, SOURCE_URL } from './landing';

/** Every string inside a nested value. */
const strings = (value: unknown): string[] =>
	typeof value === 'string'
		? [value]
		: Array.isArray(value)
			? value.flatMap(strings)
			: value && typeof value === 'object'
				? Object.values(value).flatMap(strings)
				: [];

describe('landing copy', () => {
	it('keeps the canvas tone: no exclamation marks, no apologies', () => {
		for (const s of strings(LANDING_COPY)) {
			assert.ok(!s.includes('!'), s);
			assert.doesNotMatch(s, /\b(oops|sorry|whoops)\b/i, s);
		}
	});

	it('fits a link card: the description stays under 200 characters', () => {
		assert.ok(LANDING_COPY.description.length <= 200, `${LANDING_COPY.description.length} characters`);
	});

	it('names the three steps in order', () => {
		assert.deepEqual(
			LANDING_COPY.steps.map((s) => s.title),
			['Create an account', 'Connect an Anthropic key', 'Branch the conversation']
		);
	});

	it('links out over https', () => {
		for (const url of [ANTHROPIC_KEYS_URL, SOURCE_URL]) assert.match(url, /^https:\/\//);
	});
});
```

- [ ] **Step 2: Write the failing browser tests** — `tests/e2e/landing.spec.ts`

```ts
import { expect, test } from './fixtures';

test('a stranger sees what this is, and the way in', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'A conversation is a graph, not a list.' })).toBeVisible();
	await expect(page.locator('.drawing svg[aria-hidden="true"]')).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
	await expect(page.locator('ol.steps > li')).toHaveCount(3);
	await expect(page.getByRole('link', { name: 'Anthropic API key' })).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');
	await page.getByRole('link', { name: 'Create an account' }).click();
	await expect(page).toHaveURL(/\/sign-up$/);
	await page.goto('/');
	await page.getByRole('link', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/sign-in$/);
});

test('someone signed in is welcomed back, not pitched to', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Manage your key' })).toHaveAttribute('href', '/keys');
	await page.getByRole('link', { name: 'Open the canvas' }).click();
	await expect(page).toHaveURL(/\/canvas$/);
});

test('on a phone-width window the landing page stays readable, with the desktop note above it', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'A conversation is a graph, not a list.' })).toBeVisible();
	await expect(page.getByRole('note')).toContainText('node-canvas is built for desktop');
	await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
	// Every other page is the app, and the full notice replaces it.
	await page.goto('/sign-in');
	await expect(page.getByRole('heading', { name: 'node-canvas is built for desktop' })).toBeVisible();
	await expect(page.getByLabel('Email')).toBeHidden();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test` and then `pnpm test:e2e tests/e2e/landing.spec.ts`.

Expected: FAIL.
- The unit tests fail with "Cannot find module './drawing'" and "'./landing'".
- The browser tests fail because there is no drawing, no steps list and no "Welcome back.", and `/` is hidden at 390 px.

- [ ] **Step 4: The drawing's geometry** — `src/lib/landing/drawing.ts`

```ts
/**
 * The landing page's picture of the product: one card, one fork, two cards. A branch that leaves its parent
 * on the canvas is the whole idea, and three rectangles show it. No text inside: each line of a card is a
 * rounded bar standing in for a line of type, so nothing needs translating and nothing claims to be a
 * screenshot.
 *
 * The geometry lives here, in a 360 × 200 grid that scales with its box, so the Svelte component and the
 * link-preview image script (`pnpm og:image`) draw the same picture and cannot drift apart.
 */
export const VIEWBOX = { width: 360, height: 200 } as const;

/** Every card is the same size; `pad` is the inset from a card's edge to its lines. */
export const CARD = { width: 132, height: 56, radius: 10, pad: 14 } as const;

/** Parent first, then the version you started with and the one you branched into. `lines` are the widths of the prompt and two reply lines. */
export const CARDS = [
	{ x: 114, y: 4, lines: [58, 104, 72] },
	{ x: 14, y: 140, lines: [44, 96, 62] },
	{ x: 214, y: 140, lines: [66, 104, 48] }
] as const;

export type Card = (typeof CARDS)[number];

/** The trunk under the parent, then both branches leaving the same point: the fork is an event on the parent. */
export const EDGES = ['M180 60 V72', 'M180 84 C180 112 80 108 80 140', 'M180 84 C180 112 280 108 280 140'] as const;

/** The branch handle on the trunk: a plus in a ring, the one mark that names the verb. */
export const HANDLE = { cx: 180, cy: 78, r: 6, plus: 'M176.5 78 H183.5 M180 74.5 V81.5' } as const;

export type DrawingColors = { background: string; hairline: string; muted: string; foreground: string };

/** One card's shapes: its frame, its prompt line (shorter, heavier) and two reply lines (longer, quieter). */
export function cardShapes(card: Card) {
	const [prompt, replyA, replyB] = card.lines;
	return {
		frame: { x: card.x, y: card.y, width: CARD.width, height: CARD.height, rx: CARD.radius },
		prompt: { x: card.x + CARD.pad, y: card.y + CARD.pad, width: prompt, height: 6, rx: 3 },
		replies: [
			{ x: card.x + CARD.pad, y: card.y + 30, width: replyA, height: 5, rx: 2.5 },
			{ x: card.x + CARD.pad, y: card.y + 41, width: replyB, height: 5, rx: 2.5 }
		]
	};
}

const attrs = (values: Record<string, string | number>) =>
	Object.entries(values)
		.map(([name, value]) => `${name}="${value}"`)
		.join(' ');

/** The whole drawing as standalone SVG markup, in the component's paint order: edges, parent, handle, children. */
export function drawingSvg(colors: DrawingColors, size: { width: number; height: number }): string {
	const edge = (d: string) =>
		`<path ${attrs({ d, stroke: colors.muted, 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none' })}/>`;
	const card = (c: Card) => {
		const s = cardShapes(c);
		return [
			`<rect ${attrs({ ...s.frame, fill: colors.background, stroke: colors.hairline, 'stroke-width': 1 })}/>`,
			`<rect ${attrs({ ...s.prompt, fill: colors.foreground, 'fill-opacity': 0.8 })}/>`,
			...s.replies.map((r) => `<rect ${attrs({ ...r, fill: colors.muted, 'fill-opacity': 0.45 })}/>`)
		].join('');
	};
	const handle =
		`<circle ${attrs({ cx: HANDLE.cx, cy: HANDLE.cy, r: HANDLE.r, fill: colors.background, stroke: colors.foreground, 'stroke-width': 1.5 })}/>` +
		`<path ${attrs({ d: HANDLE.plus, stroke: colors.foreground, 'stroke-width': 1.5, 'stroke-linecap': 'round' })}/>`;
	const [parent, ...children] = CARDS;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}" width="${size.width}" height="${size.height}">` +
		EDGES.map(edge).join('') +
		card(parent) +
		handle +
		children.map(card).join('') +
		'</svg>'
	);
}
```

- [ ] **Step 5: The copy** — `src/lib/copy/landing.ts`

```ts
/** The landing page's words, and the link card's (Task 2). Same tone as the canvas: say what this is, then offer the way in. */
export const LANDING_COPY = {
	title: 'node-canvas — a conversation is a graph, not a list',
	eyebrow: 'node-canvas',
	headline: 'A conversation is a graph, not a list.',
	lede: 'Every exchange is a card on a canvas. Branch from any card to take an idea somewhere else, and keep the version you started with — instead of scrolling back through a thread to find where it went wrong.',
	primary: 'Create an account',
	secondary: 'Sign in',
	keyNoteBefore: 'You will need your own ',
	keyNoteLink: 'Anthropic API key',
	keyNoteAfter: '. It takes about a minute to create, and we never see your provider bill.',
	stepsHeading: 'How it works',
	steps: [
		{ title: 'Create an account', body: 'Email and password. No card, no team setup.' },
		{
			title: 'Connect an Anthropic key',
			body: 'Paste your own API key. It is encrypted before it is stored and never returned to the browser.'
		},
		{
			title: 'Branch the conversation',
			body: 'Ask something, then fork any reply into a new direction. The version you started with stays on the canvas next to it.'
		}
	],
	openSource: 'Open source, MIT licensed.',
	source: 'Source on GitHub',
	welcomeTitle: 'Welcome back.',
	welcomeBody: 'Pick up your canvas, or manage the model key it uses.',
	openCanvas: 'Open the canvas',
	manageKey: 'Manage your key',
	/** The link card (Task 2): the headline without its full stop, as a card title. */
	ogTitle: 'A conversation is a graph, not a list',
	/** The link card's picture carries a shorter lede than the page. */
	ogLede: 'Branch any reply. Keep the version you started with.',
	ogImageAlt: 'Three cards on a canvas: one card at the top branches into two below it.',
	/** The page's meta description and the link card's: the branch-and-keep clause first, so truncation never cuts it. */
	description:
		'Branch any reply into a new direction and keep the version you started with. Every exchange is a card on a canvas, not another line in a thread. Bring your own Anthropic key.'
} as const;

export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';
export const SOURCE_URL = 'https://github.com/njmrmd/node-canvas';
```

- [ ] **Step 6: Tokens.** In `src/lib/styles/tokens.css`, add these to `:root`. Put each beside its family: the font with `--font-sans`, the text sizes with `--text-*`, the spacing with `--space-*`.

```css
	--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	--text-xs: 0.75rem;
	--text-3xl: 1.875rem;
	--space-12: 48px;
```

- [ ] **Step 7: The drawing component** — `src/lib/components/ConversationGraph.svelte`

```svelte
<!-- The product, drawn: one card, one fork, two cards. Decorative — the headline and lede say it in words. -->
<script lang="ts">
	import { CARDS, cardShapes, EDGES, HANDLE, VIEWBOX, type Card } from '$lib/landing/drawing';

	const [parent, ...children] = CARDS;
</script>

{#snippet card(c: Card)}
	{@const s = cardShapes(c)}
	<rect {...s.frame} class="frame" />
	<rect {...s.prompt} class="prompt" />
	{#each s.replies as r, i (i)}<rect {...r} class="reply" />{/each}
{/snippet}

<svg viewBox="0 0 {VIEWBOX.width} {VIEWBOX.height}" aria-hidden="true" focusable="false">
	{#each EDGES as d (d)}<path {d} class="edge" />{/each}
	{@render card(parent)}
	<circle cx={HANDLE.cx} cy={HANDLE.cy} r={HANDLE.r} class="handle" />
	<path d={HANDLE.plus} class="plus" />
	{#each children as c (c.x)}{@render card(c)}{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: auto;
	}
	/* The edges are what make three cards read as one graph, so they are drawn in --muted, never faint. */
	.edge,
	.plus {
		fill: none;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.edge {
		stroke: var(--muted);
	}
	.plus {
		stroke: var(--foreground);
	}
	.frame {
		fill: var(--background);
		stroke: var(--hairline);
		stroke-width: 1;
	}
	.prompt {
		fill: var(--foreground);
		fill-opacity: 0.8;
	}
	.reply {
		fill: var(--muted);
		fill-opacity: 0.45;
	}
	.handle {
		fill: var(--background);
		stroke: var(--foreground);
		stroke-width: 1.5;
	}
</style>
```

- [ ] **Step 8: The page** — replace `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
	import { resolve } from '$app/paths';
	import ConversationGraph from '$lib/components/ConversationGraph.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import { ANTHROPIC_KEYS_URL, LANDING_COPY as c, SOURCE_URL } from '$lib/copy/landing';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{c.title}</title></svelte:head>

{#if data.user}
	<!-- Someone returning has already read the pitch: the product's own frame, and the way back in. -->
	<Shell>
		<h1>{c.welcomeTitle}</h1>
		<p class="lede">{c.welcomeBody}</p>
		<div class="actions">
			<a class="button primary" href={resolve('/canvas')}>{c.openCanvas}</a>
			<a class="button secondary" href={resolve('/keys')}>{c.manageKey}</a>
		</div>
	</Shell>
{:else}
	<!-- A stranger: say what this is, show it, then offer the way in. -->
	<main class="hero">
		<p class="eyebrow">{c.eyebrow}</p>
		<h1>{c.headline}</h1>
		<p class="lede">{c.lede}</p>
		<div class="drawing"><ConversationGraph /></div>
		<div class="actions">
			<a class="button primary" href={resolve('/sign-up')}>{c.primary}</a>
			<a class="button secondary" href={resolve('/sign-in')}>{c.secondary}</a>
		</div>
		<p class="note">
			{c.keyNoteBefore}<a href={ANTHROPIC_KEYS_URL} target="_blank" rel="external noopener noreferrer">{c.keyNoteLink}</a
			>{c.keyNoteAfter}
		</p>
		<h2>{c.stepsHeading}</h2>
		<ol class="steps">
			{#each c.steps as step, i (step.title)}
				<li>
					<span class="number" aria-hidden="true">{i + 1}</span>
					<div>
						<p class="step-title">{step.title}</p>
						<p class="step-body">{step.body}</p>
					</div>
				</li>
			{/each}
		</ol>
		<p class="note">
			{c.openSource}
			<a href={SOURCE_URL} target="_blank" rel="external noopener noreferrer">{c.source}</a>
		</p>
	</main>
{/if}

<style>
	.hero {
		max-width: 36rem;
		margin: 0 auto;
		padding: var(--space-12) var(--space-6);
	}
	.eyebrow,
	h2 {
		margin: 0;
		font: 500 var(--text-xs) / 1 var(--font-mono);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: var(--space-4) 0 0;
		font-size: var(--text-3xl);
		line-height: 1.15;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}
	.lede {
		margin: var(--space-4) 0 0;
		font-size: var(--text-lg);
		line-height: 1.6;
		text-wrap: pretty;
	}
	.drawing {
		max-width: 28rem;
		margin: var(--space-8) auto 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-8);
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		font-weight: 500;
		text-decoration: none;
	}
	.primary {
		background: var(--foreground);
		color: var(--background);
	}
	.secondary {
		background: var(--background);
		color: var(--foreground);
		border-color: var(--hairline);
	}
	.note {
		margin: var(--space-4) 0 0;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--muted);
	}
	h2 {
		margin-top: var(--space-12);
	}
	.steps {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		border-block: 1px solid var(--hairline);
	}
	.steps li {
		display: flex;
		gap: var(--space-4);
		padding: var(--space-4) 0;
	}
	.steps li + li {
		border-top: 1px solid var(--hairline);
	}
	.number {
		font: var(--text-xs) / 1.5rem var(--font-mono);
		color: var(--muted);
	}
	.step-title {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 500;
		line-height: 1.5rem;
	}
	.step-body {
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--muted);
	}
</style>
```

If `pnpm lint` flags the external `<a href>`s under `svelte/no-navigation-without-resolve`, use that rule's documented exemption for external links. If the rule offers none, add one `eslint-disable-next-line` per external link, with the reason "external URL; resolve() is for routes". Say which in the report.

- [ ] **Step 9: The notice and the layout**

Replace `src/lib/components/DesktopOnlyNotice.svelte` with:

```svelte
<!--
	Spec §2: desktop only. Below 900 px the full notice replaces the page. On the landing page (Plan 4) a
	compact note sits above the page instead, because that is the one page a stranger opens from a shared
	link, often on a phone.
-->
<script lang="ts">
	import { copy } from '$lib/canvas/copy';

	let { compact = false }: { compact?: boolean } = $props();
</script>

{#if compact}
	<p class="desktop-note" role="note"><strong>{copy('desktop.title')}.</strong> {copy('desktop.body')}</p>
{:else}
	<main class="desktop-only" aria-labelledby="desktop-only-title">
		<h1 id="desktop-only-title">{copy('desktop.title')}</h1>
		<p>{copy('desktop.body')}</p>
	</main>
{/if}

<style>
	.desktop-only,
	.desktop-note {
		display: none;
	}
	/* Keep in step with +layout.svelte: the page hides under this same width. */
	@media (width < 900px) {
		.desktop-only {
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: var(--space-3);
			min-height: 100vh;
			padding: var(--space-6);
			font-family: var(--font-sans);
			background: var(--background);
			color: var(--foreground);
		}
		.desktop-note {
			display: block;
			margin: 0;
			padding: var(--space-3) var(--space-6);
			font-family: var(--font-sans);
			font-size: var(--text-sm);
			line-height: 1.5;
			background: var(--surface-subtle);
			color: var(--foreground);
			border-bottom: 1px solid var(--hairline);
		}
	}
	.desktop-only h1 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	.desktop-only p {
		margin: 0;
		font-size: var(--text-base);
		color: var(--muted);
	}
</style>
```

In `src/routes/+layout.svelte`:
- Import `page` from `'$app/state'`.
- Derive `const landing = $derived(page.route.id === '/');`.
- Render the compact notice before the page on `/`, and the full notice after it everywhere else.
- Hide only non-landing pages below 900 px.

The script and markup become:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import DesktopOnlyNotice from '$lib/components/DesktopOnlyNotice.svelte';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();
	// The landing page stays readable on a narrow window, with a compact note above it; every other page is
	// the app, and the full notice replaces it. Decided from the route, so the server and the browser agree.
	const landing = $derived(page.route.id === '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if landing}<DesktopOnlyNotice compact />{/if}
<div class="page" class:landing>{@render children()}</div>
{#if !landing}<DesktopOnlyNotice />{/if}
```

The style rule becomes:

```css
	/* Spec §2: desktop only. CSS switches, so a narrow window never flashes the page first.
	   Keep in step with DesktopOnlyNotice.svelte: the notice shows under this same width. */
	@media (width < 900px) {
		.page:not(.landing) {
			display: none;
		}
	}
```

In `src/lib/canvas/copy.ts`:
- Change `"desktop.body"` to `"Open it in a browser window at least 900 pixels wide."`.
- Update its comment to say Plan 4 dropped "Your canvas is saved and waiting there", because the notice also shows to people with no canvas.

- [ ] **Step 10: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`

Expected: PASS.
- There are 7 new unit tests and 3 new browser tests.
- `layout.spec.ts`'s existing tests still pass: they use `/sign-in`, which keeps the full notice.
- Check `/` at 1440 × 900 and at 390 × 844 in the browser, and say in the report what you saw.

- [ ] **Step 11: Commit**

```bash
git add src/lib/landing src/lib/copy/landing.ts src/lib/copy/landing.test.ts src/lib/components/ConversationGraph.svelte src/lib/components/DesktopOnlyNotice.svelte src/routes/+page.svelte src/routes/+layout.svelte src/lib/styles/tokens.css src/lib/canvas/copy.ts tests/e2e/landing.spec.ts
git commit -m "feat: the landing page — what this is, the drawing, and the way in

Ported from the old app's front door: a hero for strangers, Welcome back for
someone signed in. The landing page stays readable below 900 px with a compact
desktop note above it; every other page keeps the full notice.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Link previews

A link to node-canvas pasted into Slack, Messages or X should unfurl as a title, a sentence and the three-card picture, not a bare domain.

**What the root layout sets on every page:**
- the meta description;
- Open Graph tags, using `og:site_name`, `og:title` (the headline without "node-canvas", because Apple's link presenter strips a site-name prefix), `og:description`, `og:url` and `og:image` with its size and alt text;
- Twitter's `summary_large_image` card.

**The image URL is absolute and built from the request's own origin.** That way a crawler can fetch it, and a preview deployment shows its own image.

**The picture.** `static/og.png` (1200 × 630) is generated by `pnpm og:image` from the same drawing geometry as the landing page. It is never edited by hand.

**Files:**
- Create: `scripts/og-image.ts`, `static/og.png` (generated)
- Modify: `package.json` (an `og:image` script), `src/routes/+layout.svelte`, `tests/e2e/landing.spec.ts`

**Interfaces:**
- Consumes, from Task 1: `drawingSvg`, `LANDING_COPY.description`, `LANDING_COPY.ogTitle`, `LANDING_COPY.ogLede`, `LANDING_COPY.ogImageAlt`, `LANDING_COPY.eyebrow` and `LANDING_COPY.headline`.
- Produces: `pnpm og:image`, `static/og.png`, and the head tags on every page.

- [ ] **Step 1: Write the failing browser test.** Append to `tests/e2e/landing.spec.ts`:

```ts
test('a shared link unfurls with a title, a description and a 1200 × 630 picture', async ({ page, request }) => {
	await page.goto('/');
	const property = (name: string) => page.locator(`meta[property="${name}"]`);
	await expect(property('og:site_name')).toHaveAttribute('content', 'node-canvas');
	await expect(property('og:title')).toHaveAttribute('content', 'A conversation is a graph, not a list');
	await expect(property('og:description')).toHaveAttribute('content', /^Branch any reply into a new direction/);
	await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Branch any reply into a new direction/);
	await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
	const image = await property('og:image').getAttribute('content');
	// Absolute, on this deployment's own origin: a crawler has no page to resolve a relative path against.
	expect(image).toBe(new URL('/og.png', page.url()).href);
	const response = await request.get(image!);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('image/png');
	const png = await response.body();
	// A PNG's IHDR chunk carries width and height as big-endian integers at bytes 16 and 20.
	expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:e2e tests/e2e/landing.spec.ts`
Expected: FAIL. There is no `og:site_name` meta tag.

- [ ] **Step 3: The image script** — `scripts/og-image.ts`

```ts
/**
 * Renders the link-preview picture, `static/og.png` (1200 × 630), from the landing page's own drawing and
 * copy, in Playwright's pinned Chromium. Run it after changing either: `pnpm og:image`, then commit the PNG.
 * Never edit the PNG by hand.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { LANDING_COPY } from '../src/lib/copy/landing';
import { drawingSvg } from '../src/lib/landing/drawing';

const WIDTH = 1200;
const HEIGHT = 630;
/** The light theme's values from src/lib/styles/tokens.css: the card is the landing page, not the canvas. */
const COLORS = { background: '#ffffff', hairline: '#e4e4e7', muted: '#71717a', foreground: '#18181b' };

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
	body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; box-sizing: border-box; padding: 0 64px;
		display: flex; align-items: center; justify-content: space-between;
		background: ${COLORS.background}; color: ${COLORS.foreground};
		font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
	.text { max-width: 540px; }
	.eyebrow { margin: 0 0 28px; font: 500 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.18em; text-transform: uppercase; color: ${COLORS.muted}; }
	h1 { margin: 0 0 28px; font-size: 58px; line-height: 1.05; letter-spacing: -0.02em; }
	.lede { margin: 0; max-width: 340px; font-size: 24px; line-height: 1.4; color: ${COLORS.muted}; }
</style></head>
<body>
	<div class="text">
		<p class="eyebrow">${LANDING_COPY.eyebrow}</p>
		<h1>${LANDING_COPY.headline}</h1>
		<p class="lede">${LANDING_COPY.ogLede}</p>
	</div>
	${drawingSvg(COLORS, { width: 432, height: 240 })}
</body></html>`;

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	await page.setContent(html);
	await writeFile('static/og.png', await page.screenshot({ type: 'png' }));
} finally {
	await browser.close();
}
console.log(`Wrote static/og.png (${WIDTH} × ${HEIGHT}).`);
```

In `package.json` `scripts`, add `"og:image": "node --import tsx scripts/og-image.ts"`.

Then run `pnpm og:image`, open `static/og.png`, and check that it looks like the old app's card:
- the eyebrow, the headline and the lede on the left;
- the drawing on the right;
- nothing clipped.

If `pnpm check` or `pnpm lint` does not cover `scripts/*.ts`, or rejects its top-level `await` or `console.log`, make the smallest config or code change that keeps the script type-checked and linted. Say what you changed.

- [ ] **Step 4: The head tags.** In `src/routes/+layout.svelte`:
- Import `LANDING_COPY` from `'$lib/copy/landing'`.
- Derive `const origin = $derived(page.url.origin);`.
- Extend the `<svelte:head>` so that it reads:

```svelte
<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- The link card, as Slack, Messages and X unfurl it. Absolute URLs from this request's origin. -->
	<meta name="description" content={LANDING_COPY.description} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="node-canvas" />
	<meta property="og:title" content={LANDING_COPY.ogTitle} />
	<meta property="og:description" content={LANDING_COPY.description} />
	<meta property="og:url" content="{origin}/" />
	<meta property="og:image" content="{origin}/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={LANDING_COPY.ogImageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={LANDING_COPY.ogTitle} />
	<meta name="twitter:description" content={LANDING_COPY.description} />
</svelte:head>
```

- [ ] **Step 5: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`

Expected: PASS, with 1 new browser test.

- [ ] **Step 6: Commit**

```bash
git add scripts/og-image.ts static/og.png package.json src/routes/+layout.svelte tests/e2e/landing.spec.ts
git commit -m "feat: a link card — title, description and the three-card picture

The root layout carries Open Graph and Twitter tags with absolute URLs from
the request's origin. static/og.png is rendered by pnpm og:image from the
landing page's own drawing and copy.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Canvas copy that says true things

These items are from the Plan 2 and Plan 3 follow-ups.

**The offline banner** said "new messages will fail", but sending is blocked while offline. It now says sending comes back with the connection.

**Reply cards with no text.** A reply that failed, stopped before any text, or finished empty used to read "This reply didn't finish". It now reads "This reply has no text to build on". That is true of all three.

**Error lines.** The spec's §4.6 table never covered three cases:
- **A signed-out session** now gets its own line, with a Sign in link back to the canvas.
- **A missing key** now gets its own line.
- **An unavailable model** now gets its own line.

**The key action.** An auth failure now carries an "Open the key page" link, replacing the never-built "Open settings".

**Dead keys.** Five unused keys go. Two header comments that still describe the old app are rewritten.

**Files:**
- Modify: `src/lib/canvas/copy.ts`, `src/lib/canvas/copy.test.ts`, `src/lib/canvas/errors.ts` (full replacement below), `src/lib/canvas/errors.test.ts`, `src/lib/components/canvas/NodeCard.svelte`, `src/lib/shared/chat-limits.ts`, `tests/e2e/banners.spec.ts`, `tests/e2e/canvas.spec.ts`
- Create: `tests/e2e/errors.spec.ts`

**Interfaces:**
- Consumes: `NodeError`, `COPY`, and `presentError`'s callers (`NodeCard.svelte`: `failure.category`, `failure.message`, and `summaryLine` through `presentError(n.error).message`).
- **Produces, from `errors.ts`:**
  - `type ErrorKind` gains `'signed_out'` and `'model'`;
  - `type ErrorAction = { label: string; to: 'keys' | 'sign-in' }`;
  - `presentError` returns `{ kind, category, message, action: ErrorAction | null }`.
- **Produces, copy keys:**
  - new: `node.error.noKey`, `node.error.signedOut`, `node.error.unsupportedModel`, `node.action.openKeys`, `node.action.signIn`;
  - removed: `coach.branch`, `node.status.thinkingLong`, `node.action.remove`, `node.action.openSettings`, `node.action.branchFromEarlier`.

- [ ] **Step 1: Write the failing unit tests.** In `src/lib/canvas/errors.test.ts`, replace the test "maps a rejected or missing key to the auth line" with:

```ts
	it('maps a rejected key and a missing key to their own lines, each with the way to the key page', () => {
		const rejected = presentError({ code: 'invalid_api_key', message: 'x' });
		assert.equal(rejected.kind, 'auth');
		assert.equal(rejected.message, COPY['node.error.auth']);
		assert.deepEqual(rejected.action, { label: 'Open the key page', to: 'keys' });
		const missing = presentError({ code: 'no_key_configured', message: 'x' });
		assert.equal(missing.kind, 'auth');
		assert.equal(missing.message, 'No model key is connected. Connect one on the key page.');
		assert.deepEqual(missing.action, { label: 'Open the key page', to: 'keys' });
	});

	it('says a signed-out session is signed out, with the way back in', () => {
		const p = presentError({ code: 'unauthenticated', message: 'Please sign in to continue.' });
		assert.equal(p.kind, 'signed_out');
		assert.equal(p.category, 'Signed out');
		assert.equal(p.message, "You've been signed out. Sign in again to keep going.");
		assert.deepEqual(p.action, { label: 'Sign in', to: 'sign-in' });
	});

	it('says a model that is no longer offered is unavailable, and where to pick another', () => {
		const p = presentError({ code: 'unsupported_model', message: 'x' });
		assert.equal(p.kind, 'model');
		assert.equal(p.message, "This model isn't available any more. Choose another in the top bar, then send again.");
		assert.equal(p.action, null);
	});

	it('gives every other failure no action', () => {
		for (const code of ['network', 'timeout', 'model_declined', 'rate_limited', 'provider_unavailable', 'internal_error'] as const) {
			assert.equal(presentError({ code, message: 'x' }).action, null, code);
		}
	});
```

In `src/lib/canvas/copy.test.ts`:
- Remove `"coach.branch"` and `"node.status.thinkingLong"` from `SPEC_9_KEYS`.
- Add:

```ts
test("drops the keys nothing renders", () => {
  for (const key of ["coach.branch", "node.status.thinkingLong", "node.action.remove", "node.action.openSettings", "node.action.branchFromEarlier"]) {
    assert.ok(!(key in COPY), `${key} is still in the table`);
  }
});

test("says sending comes back with the connection, and what a reply with no text is", () => {
  assert.equal(copy("offline.banner"), "You're offline. Your canvas is still here, and you can send again once you're back online.");
  assert.equal(copy("branch.failed"), "This reply has no text to build on. Branch from another card, or start a new conversation.");
});
```

- [ ] **Step 2: Write the failing browser tests** — `tests/e2e/errors.spec.ts`

```ts
import { expect, test } from './fixtures';
import { send } from './helpers';

test('a send after the session has ended says so, with a way back in', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'before the session ends');
	await context.clearCookies();
	const id = await send(page, 'after the session ends', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText("You've been signed out. Sign in again to keep going.");
	await expect(card.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?next=%2Fcanvas');
});

test('a send with no key connected points to the key page', async ({ page, signIn }) => {
	await signIn();
	await page.route('**/api/chat', (route) =>
		route.fulfill({
			status: 400,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'no_key_configured', message: 'Connect a key first.' } })
		})
	);
	await page.goto('/canvas');
	const id = await send(page, 'no key behind this', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('No model key is connected. Connect one on the key page.');
	await expect(card.getByRole('link', { name: 'Open the key page' })).toHaveAttribute('href', '/keys');
});
```

Update the strings existing browser tests assert:
- `tests/e2e/banners.spec.ts` line 9 now expects `"You're offline. Your canvas is still here, and you can send again once you're back online."`.
- Every `"This reply didn't finish. Branch from another card, or start a new conversation."` in `tests/e2e/canvas.spec.ts` (four places) now expects `"This reply has no text to build on. Branch from another card, or start a new conversation."`.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test` and `pnpm test:e2e tests/e2e/errors.spec.ts tests/e2e/banners.spec.ts tests/e2e/canvas.spec.ts`
Expected: FAIL on the new tests and the updated strings.

- [ ] **Step 4: Implement**

**Edits to `src/lib/canvas/copy.ts`:**
- **Remove** `"coach.branch"` and `"node.status.thinkingLong"` from `SPEC_9`, and `"node.action.remove"`, `"node.action.openSettings"` and `"node.action.branchFromEarlier"` from `SPEC_ELSEWHERE`, with the comment line above that group if it now describes nothing.
- **`"offline.banner"`** becomes `"You're offline. Your canvas is still here, and you can send again once you're back online."`, with the comment `/* Plan 4: sending is blocked while offline, so "new messages will fail" was wrong. */`.
- **`"branch.failed"`** becomes `"This reply has no text to build on. Branch from another card, or start a new conversation."`. Its comment: `/* Plan 4: true of a reply that failed, stopped before any text, or finished empty — none will get text, so branch.disabled would promise something that cannot happen. */`.
- **Add to `PORT_RULED`:**

```ts
  /* Plan 4: the failure lines spec §4.6 never covered, and the one action each failure offers. */
  "node.error.noKey": "No model key is connected. Connect one on the key page.",
  "node.error.signedOut": "You've been signed out. Sign in again to keep going.",
  "node.error.unsupportedModel":
    "This model isn't available any more. Choose another in the top bar, then send again.",
  "node.action.openKeys": "Open the key page",
  "node.action.signIn": "Sign in",
```

- **Replace the file's top doc comment** with:

```ts
/**
 * Every user-facing string on the canvas, in one table.
 *
 * Reaching for a key is easier than typing a literal, so the keys are a closed union and `copy()` refuses at
 * compile time to render a template whose placeholders you have not supplied — `copy("limit.chip")` does not
 * type-check, and neither does passing `{used}` without `{total}`.
 *
 * Where the strings come from, by group:
 * - `SPEC_9`: the old app's copy table (§9 of its design document), carried over with the port. Plan 4's
 *   copy pass changed a few; each change carries a "Plan 4" comment.
 * - `SPEC_ELSEWHERE`: strings that document quoted outside its table.
 * - `REVIEW_APPROVED`: strings approved in the old app's design review.
 * - `PORT_RULED`: strings this port added, each with the plan that added it.
 *
 * Tone rule: state what happened and what to do next. No exclamation marks, no apologies, no "Oops". Never
 * blame the person for an error the system caused. `copy.test.ts` enforces the first two.
 */
```

- **Replace the bottom block "What §9 does not cover yet"** with:

```ts
/**
 * Known gaps, kept here because this is where someone adding a string will look:
 * - There are no screen-reader announcements for card moves. Cards are named by their prompt
 *   (`aria-labelledby`), and their statuses are visible text.
 * - The old design had the limit banner say "Resets at 00:00 UTC — in 4h 12m". This app's window is the one
 *   the server enforces, so the banner says "Resets in {time}" and counts down while it shows.
 */
```

**`src/lib/shared/chat-limits.ts`.** Replace the top doc comment with:

```ts
/**
 * Caps on what one chat request may carry.
 *
 * Both sides need them: the server refuses an over-long branch (`src/lib/server/chat.ts`), and the canvas
 * catches the same thing before spending a round trip on it. One copy, so the two can never disagree. The
 * server is still the authority: a client that skips these checks is simply refused.
 *
 * No imports: this module is shared by the browser bundle and the server.
 */
```

**Replace `src/lib/canvas/errors.ts` with:**

```ts
import { ApiCallError } from './api-client';
import { COPY } from './copy';
import type { NodeError } from './graph';

export type ErrorKind =
	| 'auth'
	| 'signed_out'
	| 'model'
	| 'timeout'
	| 'network'
	| 'declined'
	| 'too_long'
	| 'rate_limited'
	| 'provider'
	| 'unknown';

const CATEGORY: Record<ErrorKind, string> = {
	auth: 'Auth error',
	signed_out: 'Signed out',
	model: 'Model unavailable',
	timeout: 'Timed out',
	network: 'Network error',
	declined: 'Declined',
	too_long: 'Too long',
	rate_limited: 'Limit reached',
	provider: 'Provider error',
	unknown: 'Error'
};

/** Where a failure's one action leads: the key page, or sign-in and back to the canvas. */
export type ErrorAction = { label: string; to: 'keys' | 'sign-in' };

export type PresentedError = { kind: ErrorKind; category: string; message: string; action: ErrorAction | null };

/** The first-token watchdog's failure (streams.ts times out; the store records this). */
export const TIMEOUT_ERROR: NodeError = { code: 'timeout', message: 'No response arrived within the time limit.' };

const OPEN_KEYS: ErrorAction = { label: COPY['node.action.openKeys'], to: 'keys' };
const SIGN_IN: ErrorAction = { label: COPY['node.action.signIn'], to: 'sign-in' };

/** A card's failure line, chosen by code — never by matching message text. */
export function presentError(error: NodeError): PresentedError {
	const as = (kind: ErrorKind, message: string, action: ErrorAction | null = null): PresentedError => ({
		kind,
		category: CATEGORY[kind],
		message,
		action
	});
	switch (error.code) {
		case 'invalid_api_key':
			return as('auth', COPY['node.error.auth'], OPEN_KEYS);
		case 'no_key_configured':
			return as('auth', COPY['node.error.noKey'], OPEN_KEYS);
		case 'unauthenticated':
			return as('signed_out', COPY['node.error.signedOut'], SIGN_IN);
		case 'unsupported_model':
			return as('model', COPY['node.error.unsupportedModel']);
		case 'network':
			return as('network', COPY['node.error.network']);
		case 'timeout':
			return as('timeout', COPY['node.error.timeout']);
		case 'model_declined':
			return as('declined', error.message);
		case 'rate_limited':
			return as('rate_limited', error.message);
		case 'provider_unavailable':
			return as('provider', error.message);
		case 'payload_too_large':
			return as('too_long', COPY['node.error.context_too_long']);
		case 'invalid_request':
			return /too long/i.test(error.message)
				? as('too_long', COPY['node.error.context_too_long'])
				: as('unknown', COPY['node.error.unknown']);
		default:
			return as('unknown', COPY['node.error.unknown']);
	}
}

/** What `failNode` stores. Only API errors keep their message; anything else is generic. */
export function toNodeError(error: unknown): NodeError {
	if (error instanceof ApiCallError) return { code: error.code, message: error.message };
	return { code: 'internal_error', message: COPY['node.error.unknown'] };
}
```

**`src/lib/components/canvas/NodeCard.svelte`:**
- Import `resolve` from `'$app/paths'`.
- After the `failure` derived, add:

```ts
	/** A failure's way out: the key page, or sign-in and then back to the canvas. */
	const actionHref = (to: 'keys' | 'sign-in') =>
		to === 'keys' ? resolve('/keys') : `${resolve('/sign-in')}?next=${encodeURIComponent(resolve('/canvas'))}`;
```

- Replace `{#if failure}<p class="error" role="status">{failure.message}</p>{/if}` with:

```svelte
				{#if failure}
					<p class="error" role="status">
						{failure.message}
						{#if failure.action}<a class="nodrag action-link" href={actionHref(failure.action.to)}>{failure.action.label}</a>{/if}
					</p>
				{/if}
```

- Add to its `<style>`:

```css
	.action-link {
		margin-left: var(--space-1);
		color: inherit;
		text-decoration: underline;
	}
```

If `svelte/no-navigation-without-resolve` rejects the computed `href`, keep the computation in `actionHref`. Add one `eslint-disable-next-line` with the reason "built from resolve(); the query string is not a route", and say so in the report.

- [ ] **Step 5: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`

Expected: PASS.
- There are 6 new unit tests: 4 in errors and 2 in copy, minus the 1 replaced.
- There are 2 new browser tests.
- The updated strings pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/copy.ts src/lib/canvas/copy.test.ts src/lib/canvas/errors.ts src/lib/canvas/errors.test.ts src/lib/components/canvas/NodeCard.svelte src/lib/shared/chat-limits.ts tests/e2e/errors.spec.ts tests/e2e/banners.spec.ts tests/e2e/canvas.spec.ts
git commit -m "fix(canvas): copy that says true things — signed out, no key, offline, no text

A signed-out send says so and links back in; a missing key and an unavailable
model get their own lines; auth failures link to the key page. The offline
banner no longer says sends will fail (they are blocked), and a card with no
text says that rather than \"didn't finish\". Unused keys and stale comments go.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The canvas loader always offers a way on

**Before:**
- A load that failed showed "Taking longer than expected." with Retry.
- A load that stalled showed the same sentence with no Retry, so the person had nothing to do but reload.

**After:**
- A failure says it failed.
- Both states offer Retry.
- Retry aborts any stuck request, so a late answer from it cannot land after the fresh load.

**Files:**
- Modify: `src/lib/components/canvas/CanvasLoader.svelte`, `src/lib/canvas/copy.ts`
- Create: `tests/e2e/loader.spec.ts`

**Interfaces:**
- Consumes: `loadAllNodes` and `NodesPage` (`src/lib/canvas/load.ts`); `apiFetch(path, { signal })` (`src/lib/canvas/api-client.ts`, which passes `signal` to `fetch`); `signIn({ nodes })` from the e2e fixtures.
- Produces: copy key `canvas.loadFailed`.

- [ ] **Step 1: Write the failing browser tests** — `tests/e2e/loader.spec.ts`

```ts
import { expect, test } from './fixtures';

const isCanvasLoad = (url: URL) => url.pathname === '/api/nodes';

test('a failed canvas load says so, and Retry loads it', async ({ page, signIn }) => {
	await signIn({ nodes: 2 });
	let fail = true;
	await page.route(isCanvasLoad, (route) =>
		fail && route.request().method() === 'GET'
			? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal_error', message: 'x' } }) })
			: route.continue()
	);
	await page.goto('/canvas');
	await expect(page.getByText("Couldn't load your canvas. Check your connection, then retry.")).toBeVisible();
	fail = false;
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByLabel('Message')).toBeVisible();
	await expect(page.locator('article[data-node-id]').first()).toBeAttached();
});

test('a stalled canvas load offers Retry, and Retry starts over', async ({ page, signIn }) => {
	await signIn({ nodes: 2 });
	let stall = true;
	await page.route(isCanvasLoad, (route) => {
		if (stall && route.request().method() === 'GET') return; // never answered: the request hangs
		return route.continue();
	});
	await page.goto('/canvas');
	await expect(page.getByText('Taking longer than expected.')).toBeVisible({ timeout: 10_000 });
	stall = false;
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByLabel('Message')).toBeVisible();
	await expect(page.getByText('Taking longer than expected.')).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:e2e tests/e2e/loader.spec.ts`

Expected: FAIL.
- The failed load shows "Taking longer than expected.", not the new line.
- The stalled load has no Retry button.

- [ ] **Step 3: Implement**

In `src/lib/canvas/copy.ts`, add to `PORT_RULED`:

```ts
  /* Plan 4: a canvas load that failed, as opposed to one that is only slow (canvas.loadError). */
  "canvas.loadFailed": "Couldn't load your canvas. Check your connection, then retry.",
```

In `src/lib/components/canvas/CanvasLoader.svelte`, replace `load()` and `onMount`:

```ts
	/** The load in flight. Retry aborts it, so a late answer from a stuck request cannot land after a fresh one. */
	let controller: AbortController | null = null;

	async function load() {
		controller?.abort();
		const mine = new AbortController();
		controller = mine;
		failed = false;
		slow = false;
		const timer = setTimeout(() => {
			if (controller === mine) slow = true;
		}, SLOW_MS);
		try {
			const loaded = await loadAllNodes((after) =>
				apiFetch<NodesPage>(after === null ? '/api/nodes' : `/api/nodes?after=${encodeURIComponent(after)}`, {
					signal: mine.signal
				})
			);
			if (controller === mine) nodes = loaded;
		} catch {
			// An abort by Retry is not a failure: the fresh load owns the state now.
			if (controller === mine) failed = true;
		} finally {
			clearTimeout(timer);
		}
	}

	onMount(() => {
		void load();
		return () => controller?.abort();
	});
```

Replace the loading markup with:

```svelte
	<div class="loading canvas-surface" role="status">
		{#if failed}<p>{copy('canvas.loadFailed')}</p>{:else if slow}<p>{copy('canvas.loadError')}</p>{/if}
		{#if failed || slow}<button type="button" onclick={() => void load()}>{copy('canvas.loadRetry')}</button>{/if}
	</div>
```

Update the file's top comment to: `<!-- Fetches the canvas page by page, then hands the nodes to the app. Past 5 s it says so; failed or slow, Retry starts over. -->`.

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS, with 2 new browser tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/canvas/CanvasLoader.svelte src/lib/canvas/copy.ts tests/e2e/loader.spec.ts
git commit -m "fix(canvas): a failed or stalled canvas load says which, and Retry starts over

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: The composer's note stays put, and the limit banner counts down

Two items from the follow-ups.

**The composer's note.** The blocked or too-long note sat under the field. The first keystroke of a blocked draft pushed the field up 24 px, under the caret. The notes now sit above the composer, over the canvas's bottom edge, so nothing moves.

**The limit banner.** It computed "Resets in …" once and never again, so a tab left open showed a stale time. The store now records when the window resets. The banner recomputes every 15 s while it shows, and never otherwise.

**Files:**
- Modify: `src/lib/components/canvas/Composer.svelte`, `src/lib/components/canvas/CanvasApp.svelte`, `src/lib/canvas/store.svelte.ts`, `src/lib/canvas/format.ts`, `src/lib/canvas/format.test.ts`, `tests/e2e/banners.spec.ts`

**Interfaces:**
- **Consumes:**
  - `RateLimitSnapshot` (`{ limit, remaining, resetSeconds }`, `src/lib/canvas/api-client.ts`);
  - the store's private `noteRateLimit`;
  - `formatDuration(seconds)` (`src/lib/canvas/format.ts`).
- **Produces:**
  - store field `rateLimitResetAt: number | null`, the epoch milliseconds at which the window resets;
  - `secondsUntil(resetAt: number, now: number): number` in `format.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/canvas/format.test.ts`, matching its existing imports and style. Add `secondsUntil` to its import from `./format`.

```ts
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
```

If `format.test.ts` uses top-level `test(...)` rather than `describe`/`it`, use its style.

Append to `tests/e2e/banners.spec.ts`. Import `send` from `'./helpers'` if the file does not already.

```ts
test('a blocked composer explains itself without moving the field', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const field = page.getByLabel('Message');
	await expect(field).toBeVisible();
	await context.setOffline(true);
	await expect(field).toHaveAttribute('placeholder', 'Offline');
	const before = (await field.boundingBox())!;
	await field.pressSequentially('h');
	await expect(page.locator('.composer .note')).toHaveText('Offline');
	const after = (await field.boundingBox())!;
	expect([after.y, after.height]).toEqual([before.y, before.height]);
	await context.setOffline(false);
});

test('the limit banner counts down while the tab stays open', async ({ page, signIn }) => {
	await page.clock.install();
	await signIn();
	await page.route('**/api/chat', (route) =>
		route.fulfill({
			status: 429,
			contentType: 'application/json',
			headers: { 'RateLimit-Limit': '60', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '1800' },
			body: JSON.stringify({ error: { code: 'rate_limited', message: 'You have reached the limit of 60 messages this hour.' } })
		})
	);
	await page.goto('/canvas');
	await send(page, 'one too many', { wait: false });
	await expect(page.getByText("You've used your 60 messages for this hour. Resets in 30 minutes.")).toBeVisible();
	await page.clock.fastForward('10:00');
	await expect(page.getByText("You've used your 60 messages for this hour. Resets in 20 minutes.")).toBeVisible();
});
```

**If the canvas does not load under `page.clock.install()`.** This would happen if Playwright 1.63's installed clock does not flow on its own. Look up the 1.63 clock API in `node_modules/playwright-core`, and use the call that lets time flow, for example `install()` followed by `resume()`. Keep the assertions as written, and say what you used.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test` and `pnpm test:e2e tests/e2e/banners.spec.ts`

Expected: FAIL.
- `secondsUntil` is not exported.
- The field moves when the note appears.
- The banner still says 30 minutes after the fast-forward.

- [ ] **Step 3: Implement**

`src/lib/canvas/format.ts`, add:

```ts
/** Whole seconds from `now` until `resetAt` (both epoch milliseconds), rounded up, never negative. */
export function secondsUntil(resetAt: number, now: number): number {
	return Math.max(0, Math.ceil((resetAt - now) / 1000));
}
```

`src/lib/canvas/store.svelte.ts`:
- Add the field `rateLimitResetAt = $state<number | null>(null);` after `rateLimit`, with the doc `/** When the hourly window resets, in epoch milliseconds — the limit banner counts down to it. */`.
- In `noteRateLimit`, right after `this.rateLimit = snapshot;`, add `this.rateLimitResetAt = Date.now() + snapshot.resetSeconds * 1000;`.

`src/lib/components/canvas/CanvasApp.svelte`:
- Import `secondsUntil` alongside `formatDuration`.
- Add to the script:

```ts
	// "Resets in …" counts down while the limit banner shows: one tick every 15 s, and none otherwise.
	let now = $state(Date.now());
	$effect(() => {
		if (!store.limitReached) return;
		now = Date.now();
		const tick = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(tick);
	});
```

- The limit banner's `time` becomes `formatDuration(secondsUntil(store.rateLimitResetAt ?? now, now))`.

`src/lib/components/canvas/Composer.svelte`:
- Replace the two note lines with:

```svelte
	{#if tooLong || showBlocked}
		<!-- Above the composer, over the canvas's bottom edge: a note never moves the field under the caret. -->
		<div class="notes">
			{#if tooLong}<p class="note" role="status">{copy('composer.tooLong')}</p>{/if}
			{#if showBlocked}<p class="note" id="composer-blocked" role="status">{blocked}</p>{/if}
		</div>
	{/if}
```

- Add `position: relative;` to the `.composer` rule.
- Replace the `.note` rule with:

```css
	.notes {
		position: absolute;
		left: var(--space-6);
		bottom: calc(100% + var(--space-2));
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		max-width: 860px;
		z-index: var(--z-composer);
		pointer-events: none;
	}
	.note {
		margin: 0;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`

Expected: PASS, with 2 new unit tests and 2 new browser tests.
- The existing offline and hourly-limit tests still find `.composer .note`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/canvas/Composer.svelte src/lib/components/canvas/CanvasApp.svelte src/lib/canvas/store.svelte.ts src/lib/canvas/format.ts src/lib/canvas/format.test.ts tests/e2e/banners.spec.ts
git commit -m "fix(canvas): the composer's note no longer moves the field, and the limit banner counts down

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: Visual polish — readable dimming, styles from tokens

**Dimming.** Dimmed cards at opacity 0.45 put body text at 3.25:1 and soft text at 2.61:1, below WCAG AA. At 0.75 both clear 4.5:1. The edges still fade to 0.35 and the path still draws in gold, so the focus path stays obvious.

**Tokens.** The canvas components' remaining literals become tokens:
- the shadows on the card and the toast;
- three numeric font weights;
- three 28 px control heights;
- the sheet's backdrop colour.

A unit test keeps them out.

**Files:**
- Modify: `src/lib/styles/canvas-tokens.css`, `src/lib/components/canvas/NodeCard.svelte`, `src/lib/components/canvas/UndoToast.svelte`, `src/lib/components/canvas/Composer.svelte`, `src/lib/components/canvas/LinearView.svelte`, `src/lib/components/canvas/TopBar.svelte`, `src/lib/components/canvas/ShortcutsSheet.svelte`, `tests/e2e/focus.spec.ts`
- Create: `src/lib/styles/canvas-styles.test.ts`

**Interfaces:**
- Consumes: `--shadow-1` and `--shadow-2` (already in `canvas-tokens.css`, resolved through `light-dark()` under the canvas's `color-scheme: dark`).
- Produces: tokens `--weight-strong: 600`, `--control-height-sm: 28px` and `--scrim: rgb(0 0 0 / 0.5)` in `canvas-tokens.css`.

- [ ] **Step 1: Write the failing tests**

`src/lib/styles/canvas-styles.test.ts`:

```ts
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
```

In `tests/e2e/focus.spec.ts`, in the first test, add this directly after `await fit(page);`:

```ts
	await page.mouse.move(2, 2); // over the top bar: no card is hovered, so dimming shows
	await expect(card(a)).toHaveCSS('opacity', '0.75');
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test` and `pnpm test:e2e tests/e2e/focus.spec.ts`

Expected: FAIL.
- The style test names NodeCard, UndoToast, Composer, LinearView, TopBar and ShortcutsSheet.
- The dimmed card's opacity is 0.45.

- [ ] **Step 3: Implement**

`src/lib/styles/canvas-tokens.css`: add these inside `.canvas-surface`. Put `--weight-strong` beside `--weight-user-text`, and the other two near the shadows, each with a one-line comment.

```css
  --weight-strong: 600;
  --control-height-sm: 28px;
  --scrim: rgb(0 0 0 / 0.5);
```

**Components:**
- **NodeCard.svelte:**
  - `box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);` becomes `box-shadow: var(--shadow-1);`.
  - `min-height: 28px;` becomes `min-height: var(--control-height-sm);`.
  - In `.card.dim:not(:hover):not(:focus-within)`, `opacity: 0.45;` becomes `opacity: 0.75;`, with the comment `/* 0.75 keeps body and soft text at WCAG AA (4.5:1); the faded edges and the gold path carry the focus. */`.
- **UndoToast.svelte:** `box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);` becomes `box-shadow: var(--shadow-2);`.
- **Composer.svelte, LinearView.svelte, TopBar.svelte:** `font-weight: 600;` becomes `font-weight: var(--weight-strong);`.
- **LinearView.svelte, ShortcutsSheet.svelte:** `min-height: 28px;` becomes `min-height: var(--control-height-sm);`.
- **ShortcutsSheet.svelte:** `background: rgb(0 0 0 / 0.5);` becomes `background: var(--scrim);`.

**If the style test still names a file,** tokenise that literal the same way. Use an existing token where one fits, otherwise add one beside these three in `canvas-tokens.css`.

**Do not change colours** that a component already takes from a token.

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`

Expected: PASS.
- There is 1 new unit test.
- The focus test checks the opacity.
- Look at the canvas in the browser, with one card dimmed and one not, and say in the report what you saw.

- [ ] **Step 5: Commit**

```bash
git add src/lib/styles/canvas-tokens.css src/lib/styles/canvas-styles.test.ts src/lib/components/canvas tests/e2e/focus.spec.ts
git commit -m "style(canvas): readable dimming, and shadows, weights and control heights from tokens

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 7: The cutover runbook, and the documents

Cutover is the human's. Every step is a production or account action:
- the Skew Protection setting;
- merging;
- a real-key smoke test;
- archiving the old repository.

This task writes those steps as a runbook, re-runs the performance budget, and brings the documents up to date with Plan 4.

**Files:**
- Create: `docs/cutover.md`
- Modify: `docs/superpowers/notes/2026-10-06-plan-2-followups.md`, `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: documents only.

- [ ] **Step 1: Run the performance budget**

Run: `pnpm test:perf`
Expected: PASS, with p95 ≤ 20 ms. Record the sample line in the report. If p95 goes over 20 ms, report DONE_WITH_CONCERNS with the sample and stop. Do not change the threshold or the workload.

- [ ] **Step 2: The runbook** — create `docs/cutover.md`:

```markdown
# Cutover: node-canvas replaces node-canvas-chat

Spec §10: once §1's success criteria pass on production, move any custom domain to the new project and
archive the old repository. There is no data to migrate: node-canvas has its own database.

Every step below is a production or account action. Do them yourself, in order.

## 1. Merge Plan 3, safely

- [ ] In Vercel, open the `node-canvas` project (team `rwazi-design`) → Settings → Advanced, and turn on
      **Skew Protection**. Plan 3 adds a stream frame (`ping`) that a tab still running the Plan 2 bundle
      treats as an error, and that tab's new replies are then lost. With Skew Protection, an open tab keeps
      talking to the deployment it loaded from. If you leave it off, reload every open canvas tab right
      after the deploy instead.
- [ ] Merge PR #2 (Plan 3) once `verify` is green. Merging deploys production.
- [ ] `curl -s https://node-canvas-theta.vercel.app/api/health` reports the merge commit.

## 2. Merge Plan 4

- [ ] Merge the Plan 4 PR once `verify` is green, then check `/api/health` again.

## 3. Check spec §1 on production

| Criterion | How it is checked |
| --- | --- |
| Feature parity on desktop | The browser suite in CI (`pnpm test:e2e`), and the smoke test below. |
| Branching binds the composer every time | `interaction.spec.ts`'s 20-run branch test, on every CI run. |
| A canvas of any size saves; a failed save is visible | The paged load (`GET /api/nodes`), "a 350 KB reply survives a reload", and the save-failed banner test. |
| p95 ≤ 20 ms at 4× CPU, 50 nodes, 3 streams | `pnpm test:perf`, run locally before cutover. |
| Every CI job blocks merging | One `verify` job runs every check; branch protection requires it on `main`. |
| §7's security properties, each with a test | `pnpm test` and `pnpm test:db`: vault, passwords, sessions, CSRF, tenant isolation, headers. |

## 4. Smoke test with your own key

- [ ] Sign up at https://node-canvas-theta.vercel.app/sign-up with a throwaway address.
- [ ] Connect your key on `/keys`. The last four characters show.
- [ ] On `/canvas`, with Claude Opus 5.5, send something that makes it think for a while. For example: "Prove
      that there are infinitely many primes in three different ways, then compare the proofs." The card shows
      Thinking, then the reasoning summary and the reply. It never shows "Timed out".
- [ ] Branch from the reply and send a follow-up. The composer names the card you branched from.
- [ ] Reload. Everything is where you left it.
- [ ] Delete a card, then Undo. Delete it again and reload: it stays gone.
- [ ] Press `T`, then Copy all, and paste it somewhere: a You / Assistant transcript.
- [ ] Narrow the window below 900 px: the desktop notice. Widen it again: the canvas is back, unmoved.
- [ ] On `/keys`, delete the account. Signing in with it again fails.

## 5. The link card

- [ ] Paste https://node-canvas-theta.vercel.app into Slack or Messages. It unfurls with "A conversation is a
      graph, not a list", the description and the three-card picture. Vercel's Deployment Protection must not
      cover the production URL, or crawlers cannot fetch the card.

## 6. Retire the old app

- [ ] There is no custom domain to move. On 2026-10-07, `vercel domains ls` found none under `rwazi-design`
      or `nicholasm`. If one exists by the time you cut over, move it to `node-canvas` first.
- [ ] Archive the old repository: `gh repo archive njmrmd/node-canvas-chat --yes`. You can unarchive it from
      the repository's settings.
- [ ] Retire the old deployment.
  - On 2026-10-07, `vercel project ls` listed no `node-canvas-chat` project under either scope.
  - But the `rwazi-design` Storage tab still lists the Neon store `neon-cyan-dog` as connected to
    `node-canvas-chat`.
  - Remove that project's production deployment if it still serves.
  - Delete the store once you no longer need the old app's canvases. Nothing migrates from it.
```

- [ ] **Step 3: The follow-ups note.** In `docs/superpowers/notes/2026-10-06-plan-2-followups.md`:

**Rename and reframe.**
- Rename the title to `# Plan 2, Plan 3 and Plan 4 follow-ups`.
- Add one sentence to the first paragraph saying Plan 4 resolved the "before cutover" items.

**Add a section** after "Resolved in Plan 3":

```markdown
## Resolved in Plan 4

- **Copy.**
  - The offline banner says sending comes back with the connection.
  - The limit banner counts down.
  - The never-built "Open settings" is gone; an auth failure links to the key page.
  - A signed-out send says so and links to sign-in.
  - A missing key and an unavailable model get their own lines.
  - A card with no text says that, not "didn't finish".
  - The desktop notice no longer promises a saved canvas to people with none.
  - A failed canvas load says it failed, and a stalled one offers Retry.
  - Stale comments in `copy.ts` and `chat-limits.ts` are rewritten.
- **Design.**
  - Dimmed cards stay at WCAG AA (opacity 0.75).
  - The composer's note no longer moves the field.
  - Shadows, weights and control heights in the canvas components come from tokens, and a test keeps them
    there.
- **Front door.**
  - A landing page, readable on phones.
  - A link card (`static/og.png`, rendered by `pnpm og:image`).
```

**Remove the resolved lists.**
- Remove the "### Before cutover (Plan 4)" subsection under "Still open".
- Remove the "### Before cutover (Plan 4), design and copy" subsection under "Plan 3 review findings (open)".
- Move that subsection's one unresolved bullet, the resize corner on a card under 120 px tall, to the end of
  "### Canvas".

- [ ] **Step 4: The spec.** In `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`:
- **§8 Routes.** Replace "A root layout renders `DesktopOnlyNotice` instead of the page below ~900 px width." with "A root layout renders `DesktopOnlyNotice` instead of the page below 900 px width — except on `/`, which stays readable with a compact note above it (Plan 4: the landing page is the page a stranger opens from a shared link, often on a phone)."
- **§10 Cutover.** Append: "The steps are in `docs/cutover.md`; as of 2026-10-07 there is no custom domain to move."
- **§12.** Replace "Decided defaults the plan may revisit: the 900 px desktop threshold; 1.5 s save interval; per-preview Neon branches off." with "Decided: the 900 px desktop threshold; the 1.5 s save interval; per-preview Neon branches on (since Plan 2)."
- Check each changed sentence against the code and the Vercel facts the ledger records.

- [ ] **Step 5: AGENTS.md.** In the hand-written part, add this section after "## Canvas conventions":

```markdown
## Landing page and link card

- The landing page's words live in `src/lib/copy/landing.ts`; the canvas's in `src/lib/canvas/copy.ts`.
  No UI text as literals in components.
- The three-card drawing's geometry lives in `src/lib/landing/drawing.ts`. The landing page's
  `ConversationGraph.svelte` and `pnpm og:image` both draw from it. After changing the drawing or the
  landing copy, run `pnpm og:image` and commit `static/og.png`; never edit the PNG by hand.
- The root layout carries the link card's meta tags, with absolute URLs from the request's origin.
- Below 900 px every page shows the desktop notice instead of itself, except `/`, which stays readable
  with a compact note above it.
```

- [ ] **Step 6: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e`
Expected: PASS. Paste the summary lines in the report. This run confirms the whole branch, so report any failure, even one unrelated to the documents.

- [ ] **Step 7: Commit**

```bash
git add docs/cutover.md docs/superpowers/notes/2026-10-06-plan-2-followups.md docs/superpowers/specs/2026-09-25-sveltekit-port-design.md AGENTS.md
git commit -m "docs: the cutover runbook, and what Plan 4 resolved

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

### Spec coverage, Plan 4's share

- **§4 landing page "with a route into sign-up (and the product image / OG card)":** Tasks 1 and 2.
- **§10 cutover "move any custom domain to the new project, archive `njmrmd/node-canvas-chat`":** Task 7's runbook. These are human actions.
- **§1 success criteria verified on production:** Task 7's runbook, section 3. The perf budget is re-run in Task 7, step 1.
- **The follow-ups note's "Before cutover (Plan 4)" lists:** Tasks 3–6, except the resize-corner quirk (below).

### Deliberate deviations, for review

1. **`/` stays readable below 900 px,** with a compact notice above it. Spec §8 says the notice replaces every page. The landing page is the one a stranger opens from a shared link, often on a phone, and the notice alone says nothing about what the product is. Every other route keeps the full notice.
2. **The model allowlist is still hand-maintained** (`src/lib/shared/models.ts`), not refreshed from Anthropic at build time as §6 and §11 say. That would need a real key in the build environment, so it stays out of scope here, unchanged since Plan 2.
3. **The resize-corner shrink stays open.** On a card under 120 px tall, the corner first shrinks the card during a drag; the saved size ends valid. This is @xyflow/svelte 1.7.0's clamp. Fixing it means feeding the control a live height. The follow-ups note keeps it, under Canvas.
4. **Cutover is a runbook, not a task an implementer runs.** Every step changes production, an account or a repository.

### Names used across tasks

- **Task 1:** `VIEWBOX`, `CARD`, `CARDS`, `EDGES`, `HANDLE`, `Card`, `DrawingColors`, `cardShapes`, `drawingSvg`; `LANDING_COPY`, `ANTHROPIC_KEYS_URL`, `SOURCE_URL`; `DesktopOnlyNotice`'s `compact`; and the tokens `--font-mono`, `--text-xs`, `--text-3xl`, `--space-12`.
- **Task 2:** `pnpm og:image`, `static/og.png`.
- **Task 3:** `ErrorKind` (`'signed_out'`, `'model'`), `ErrorAction`, `PresentedError`; the copy keys `node.error.noKey`, `node.error.signedOut`, `node.error.unsupportedModel`, `node.action.openKeys`, `node.action.signIn`.
- **Task 4:** `canvas.loadFailed`.
- **Task 5:** `rateLimitResetAt`, `secondsUntil`.
- **Task 6:** `--weight-strong`, `--control-height-sm`, `--scrim`.

### Deploy

- Plan 4 needs no migration.
- Its PR stacks on Plan 3's. Merge PR #2 first; the runbook's step 1 covers Skew Protection.
