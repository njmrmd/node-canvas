# node-canvas Plan 3 — Canvas features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rest of the canvas the spec describes, plus the three cutover blockers Plan 2's reviews found:
- Retry, Continue and Regenerate.
- Delete with Undo.
- Resizing and collapsing cards.
- Focus-path dimming.
- The linear transcript view and the shortcuts sheet, with keyboard control for every shortcut the sheet lists.
- Zoom to 100%.
- The desktop-only notice.

**Architecture:** As in Plan 2, framework-free modules decide and are unit-tested:
- existing: `graph.ts`, the saver, the markdown parser;
- new: `navigation.ts`, `shortcuts.ts`, `transcript.ts`, `load.ts`.

The runes store (`store.svelte.ts`) applies those modules, and components render and forward events. One `svelte:window` keydown handler in `Canvas.svelte` turns keys into commands through `resolveShortcut`. The canvas loads its nodes page by page from a new `GET /api/nodes`, each page at most 3 MiB, instead of all at once in the page data.

**Tech Stack:** As Plan 2: SvelteKit 2, Svelte 5 runes, `@xyflow/svelte` 1.7.0 (now also `NodeResizeControl` and `ControlButton`), `node:test`, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md` §§4, 6, 8, 9. This is plan 3 of 4:
1. foundation and accounts (done);
2. canvas core (done);
3. canvas features (this plan);
4. landing page, copy pass and cutover.

Also read `docs/superpowers/notes/2026-10-06-plan-2-followups.md`. Its three cutover blockers are Tasks 1–3 here.

**Old app:** behaviour, constants and copy that the spec only names come from the old app at `njmrmd/node-canvas-chat@c215512`:
- `shortcuts-sheet.tsx`, `canvas-app.tsx` and `use-canvas-controller.ts`;
- `node-card.tsx` and `linear-view.tsx`.

Each is cited where it is used. Where the old app had a defect, this plan says what to do instead.

## Global Constraints

- **Repo and branch.** Repo: `/Users/nicholas/Workspace/node-canvas`. Work on the branch `plan-3-canvas-features`, cut from `main` at `cb3b054`. `main` is protected and requires the `verify` check; open a PR at the end.
- **Desktop only.** No touch gestures, no mobile layouts, no `pointer: coarse` code.
- **Svelte 5 runes only.**
  - Use `$props`, `$state`, `$derived`, `$effect` and event attributes such as `onclick`.
  - No `svelte/store` and no Tailwind.
  - Styles go in component `<style>` blocks and use tokens.
- **Import rules.** `src/lib/shared/**`, `src/lib/canvas/**` (except `*.svelte.ts`) and `src/lib/server/**` use relative imports only, with no `$app/*` or `$env/*`, so `node:test` can load them.
- **Test locations.**
  - Unit tests: `*.test.ts`, run by `pnpm test`.
  - Database tests: `*.dbtest.ts`, run by `pnpm test:db`.
  - Browser tests: `tests/e2e/*.spec.ts`, run by `pnpm test:e2e`.
  - Performance: `pnpm test:perf`, local only.
- **The composer target invariant** (spec §8, restated). `target` changes only through:
  - Branch (the button or `B`);
  - sending, which includes Continue and Regenerate because they send on the user's behalf;
  - New conversation;
  - Enter on a focused card;
  - deleting the target or one of its ancestors. That sets it to `null`, and Undo puts it back if nothing else has changed it since.

  Focus moves, clicks on a card or the pane, collapsing, resizing and zooming never change it.
- **Keyboard.**
  - One `svelte:window` keydown handler, in `Canvas.svelte`, handles every canvas shortcut.
  - Nothing fires while focus is in an `input`, `textarea`, `select` or contenteditable, or while the shortcuts sheet is open.
  - Letter and digit shortcuts ignore presses with Cmd, Ctrl or Alt held.
  - Card commands act only when the key went to a card itself, meaning `article[data-node-id]` has DOM focus.
- **The shortcuts sheet** lists exactly the 21 rows of the old sheet, in its order and wording, and every row works.
- **Constants.**
  - Nudge: 16 px, or 64 px with Shift.
  - Keyboard resize: 8 px, or 32 px with Shift.
  - Card size: width 240–640, height 120–900.
  - Undo: one level, available for 8000 ms.
  - Zoom: steps of ×1.2, between 0.25 and 2. The anchor is the focused card's centre, else the canvas centre.
  - `CONTINUE_PROMPT = "Continue from where you left off."`
  - Canvas-load page budget: 3 MiB.
- **Copy.** Every new user-facing string goes into `src/lib/canvas/copy.ts` under `PORT_RULED`, with a one-line comment saying where it comes from. The one exception is the shortcuts sheet rows, which live in `shortcuts.ts` as a transcription of the old sheet.
- **Logging.** Never log keys, tokens, passwords, prompts, responses, emails or error messages. Log the route, error name and code only.
- **Commits.**
  - Every commit ends with `Co-Authored-By: <your model> <noreply@anthropic.com>`, and uses conventional prefixes.
  - A commit that touches auth, key storage or the provider route says where the key lives, what encrypts it, and what a database read yields.
- **Before handing over any task,** run `pnpm check && pnpm lint && pnpm test`. Also run `pnpm test:db` and `pnpm test:e2e` when the task touches them. `pnpm check` must report 0 errors and 0 warnings.

## Review Focus

These are the five conditions the spec implies that a person is most likely to hit, each with the test that pins it in the task that owns it:

1. **Deleting a card while it, or a card below it, is still streaming or queued.**
   - The streams stop.
   - Undo brings the branch back as "Stopped" with its text, never as a spinner with no request behind it.
   - Nothing comes back after a reload.
   - → Task 7 e2e "deleting a streaming branch stops it, and Undo brings it back as Stopped".
2. **Deleting an ancestor of the composer target**, which crashed the old app.
   - The composer falls back to "New conversation", and Undo binds it to the old target again.
   - → Task 7 e2e "deleting an ancestor of the target clears the composer, and Undo rebinds it".
3. **Moving keyboard focus to a card that is not drawn**, either off screen under `onlyRenderVisibleElements` or inside a collapsed subtree.
   - The canvas pans to an off-screen card and focuses it. Hidden cards are skipped.
   - → Task 4 unit "never lands on a hidden card"; Task 10 e2e "End reaches an off-screen card and focuses it".
4. **Closing the tab right after a delete, or undoing after the delete has reached the server.**
   - The delete still holds after a reload, and so does the undo.
   - → Task 6 unit tests "the unload save also sends pending deletes, with keepalive, and keeps them pending" and "Undo before the flush means the server never hears of the delete"; Task 7 e2e "a delete survives a reload, and so does its undo".
5. **Typing shortcut keys into the composer or the model selector** (T, F, 0, L, Backspace).
   - They only edit the field and never act on the canvas.
   - → Task 5 unit "nothing fires while typing"; Task 10 e2e "typing T, F, 0 and Backspace in the composer only edits the draft".

## File structure (added or changed by Plan 3)

```
src/lib/server/nodes.ts (+test, +dbtest)   loadNodesPage, loadView, cursors (Task 1)
src/routes/api/nodes/+server.ts            + GET (Task 1)
src/routes/canvas/+page.server.ts          view only, no nodes (Task 1)
src/lib/canvas/
  load.ts (+test)          loadAllNodes — the paged canvas load (Task 1)
  markdown.ts (+test)      MarkdownStream; list fixes (Task 3)
  graph.ts (+test)         structure, hidden, branch extract/restore, retry/continue/regenerate rules (Task 4)
  navigation.ts (+test)    moveFocus over the drawn cards (Task 4)
  viewport.test.ts         zoomAt / rectInView / focusOn (Task 4)
  shortcuts.ts (+test)     resolveShortcut, SHORTCUT_ROWS (Task 5)
  saver.ts (+test)         deletes, fair retries, view after its target, one unload save (Task 6)
  transcript.ts (+test)    transcriptText (Task 9)
  store.svelte.ts          actions for Tasks 7–11
  copy.ts (+test)          PORT_RULED additions
src/lib/shared/chat-types.ts                + { type: 'ping' } (Task 2)
src/lib/server/anthropic.ts (+test)         ping on message_start (Task 2)
src/lib/components/canvas/
  CanvasLoader.svelte (new, Task 1)   UndoToast.svelte (new, Task 7)
  LinearView.svelte (new, Task 9)     ShortcutsSheet.svelte (new, Task 9)
  Canvas, CanvasApp, NodeCard, Composer, TopBar, Markdown .svelte (changed)
src/lib/components/DesktopOnlyNotice.svelte (new, Task 11)
src/routes/+layout.svelte                   notice below 900 px (Task 11)
tests/support/seed-server.ts               + thinkingChars (Task 1)
tests/support/fake-anthropic.ts            + [midfail], [empty] (Tasks 2, 11)
tests/e2e/
  helpers.ts (new, Task 1)   cards.spec.ts (Task 7)   sizes.spec.ts (Task 8)
  focus.spec.ts (Task 9)     keyboard.spec.ts (Task 10)   layout.spec.ts (Task 11)
```

---

### Task 1: Load the canvas in pages

Cutover blocker I1. Today the canvas page's server load puts every node's full text into `__data.json`. Vercel caps a function response at 4.5 MB, so a canvas past that size would stop opening. After this task:
- The page load returns only the view.
- The browser fetches the nodes from `GET /api/nodes`, page by page, before it builds the store.
- A page holds at most 3 MiB of text, or one larger node on its own.

This task also moves the browser-test helpers that several specs duplicate into one file. The save-wait helpers read `__data.json`, so they have to change in this task anyway.

**Files:**
- Modify: `src/lib/server/nodes.ts`, `src/lib/server/nodes.test.ts`, `src/lib/server/nodes.dbtest.ts`
- Modify: `src/routes/api/nodes/+server.ts`, `src/routes/canvas/+page.server.ts`, `src/routes/canvas/+page.svelte`
- Create: `src/lib/canvas/load.ts`, `src/lib/canvas/load.test.ts`, `src/lib/components/canvas/CanvasLoader.svelte`
- Modify: `src/lib/components/canvas/CanvasApp.svelte`
- Modify: `tests/support/seed-server.ts`
- Create: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/canvas.spec.ts`, `tests/e2e/interaction.spec.ts`, `tests/e2e/nodes-api.spec.ts`

**Interfaces:**
- **Consumes.**
  - From Plan 2 (`nodes.ts`): `NodeRow`, the row mapping inside `loadCanvas`, `isUuid`, `query`, `queryOne`.
  - `apiFetch<T>(path, init?)`, which does a GET by default.
  - The copy keys `canvas.loadError` ("Taking longer than expected.") and `canvas.loadRetry` ("Retry").
- **Produces, server.**
  - `PAGE_BYTES = 3 * 1024 * 1024`.
  - `type Cursor = { createdAt: string; id: string }`, where `createdAt` is exact UTC microseconds, `YYYY-MM-DDTHH:MM:SS.ffffffZ`.
  - `encodeCursor(c): string` and `decodeCursor(s): Cursor | null`.
  - `takePage<T extends { bytes: number }>(rows, budget): T[]`.
  - `loadNodesPage(userId, after: Cursor | null, budget = PAGE_BYTES): Promise<{ nodes: NodeWire[]; next: Cursor | null }>`.
  - `loadView(userId): Promise<ViewWire | null>`.
  - `loadCanvas(userId)`: same signature as before, now built on the pages.
- **Produces, routes.**
  - `GET /api/nodes` and `GET /api/nodes?after=<cursor>` → `{ nodes: NodeWire[]; next: string | null }`.
  - Canvas page data: `{ view, hasKey, email, models, defaultModelId }`. It no longer includes `nodes`.
- **Produces, client.**
  - `type NodesPage = { nodes: NodeWire[]; next: string | null }`, `MAX_PAGES = 1000`.
  - `loadAllNodes(fetchPage: (after: string | null) => Promise<NodesPage>): Promise<NodeWire[]>`.
  - `CanvasApp` props become `{ data, nodes }`.
- **Produces, tests.**
  - The seed request gains `thinkingChars?: number`.
  - `tests/e2e/helpers.ts` exports `cards(page)`, `sleep(ms)`, `send(page, prompt, { wait? })` (returns the new id), `savedNodesText(page)`, `viewport(page)`, `settled(page)`, `emptyCanvasPoint(page)` and `fit(page)`.

- [ ] **Step 1: Write the failing unit tests**

In `src/lib/server/nodes.test.ts`, change the `./nodes` import to `import { decodeCursor, encodeCursor, isUuid, parseSaveBody, takePage } from './nodes';` and append:

```ts
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
```

Create `src/lib/canvas/load.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllNodes, MAX_PAGES, type NodesPage } from './load';
import type { NodeWire } from './node-wire';

const fake = (id: string) => ({ id }) as unknown as NodeWire;

describe('loadAllNodes', () => {
	it('follows the cursors and returns every page in order', async () => {
		const pages: Record<string, NodesPage> = {
			start: { nodes: [fake('a'), fake('b')], next: 'c1' },
			c1: { nodes: [fake('c')], next: 'c2' },
			c2: { nodes: [fake('d')], next: null }
		};
		const asked: (string | null)[] = [];
		const nodes = await loadAllNodes(async (after) => {
			asked.push(after);
			return pages[after ?? 'start'];
		});
		assert.deepEqual(nodes.map((n) => n.id), ['a', 'b', 'c', 'd']);
		assert.deepEqual(asked, [null, 'c1', 'c2']);
	});

	it('gives up rather than loop forever on a server that never ends', async () => {
		let calls = 0;
		await assert.rejects(
			loadAllNodes(async () => {
				calls += 1;
				return { nodes: [], next: 'again' };
			}),
			/more pages/
		);
		assert.equal(calls, MAX_PAGES);
	});
});
```

In `src/lib/server/nodes.dbtest.ts`:
- Change the `./nodes` import to `import { deleteNode, loadCanvas, loadNodesPage, parseSaveBody, saveNodes, type Cursor } from './nodes';`.
- Replace the `make` helper inside `before()` with this module-level helper, used by `before()` and by the new tests:

```ts
const user = async (email: string) =>
	(await queryOne<{ id: string }>("insert into users (email, password_hash) values ($1, 'x') returning id", [email]))!.id;
```

so that `before()` reads `a = await user('a@nodes.test'); b = await user('b@nodes.test');`. Then append:

```ts
describe('loadNodesPage', () => {
	it('pages through a canvas in creation order, by bytes, without losing or repeating a node', async () => {
		const owner = await user('pages@nodes.test');
		const nodes = Array.from({ length: 5 }, (_, i) =>
			wire({ response: 'r'.repeat(1000), createdAt: 1_700_000_100_000 + i, updatedAt: 1_700_000_100_000 + i })
		);
		await saveNodes(owner, nodes, null);
		const seen: string[] = [];
		let after: Cursor | null = null;
		let pages = 0;
		do {
			const page: { nodes: { id: string }[]; next: Cursor | null } = await loadNodesPage(owner, after, 2500);
			pages += 1;
			seen.push(...page.nodes.map((n) => n.id));
			after = page.next;
		} while (after !== null);
		assert.deepEqual(seen, nodes.map((n) => n.id));
		assert.equal(pages, 5); // each node is ~1514 bytes against a 2500-byte budget
	});

	it("only ever returns the signed-in user's nodes", async () => {
		const owner = await user('mine@nodes.test');
		const other = await user('theirs@nodes.test');
		await saveNodes(other, [wire()], null);
		const mine = wire();
		await saveNodes(owner, [mine], null);
		const page = await loadNodesPage(owner, null);
		assert.deepEqual(page.nodes.map((n) => n.id), [mine.id]);
		assert.equal(page.next, null);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test && pnpm test:db`
Expected: FAIL — `decodeCursor`, `takePage`, `loadNodesPage` are not exported; `./load` not found.

- [ ] **Step 3: Implement the server side**

In `src/lib/server/nodes.ts`:
- Add the constants and helpers below after `isUuid`.
- Move the row-to-wire mapping out of `loadCanvas` into `fromRow`.
- Replace `loadCanvas` with the three functions at the end of the block.

```ts
/** A page of the canvas load stays well under Vercel's 4.5 MB response cap, even with JSON escaping. */
export const PAGE_BYTES = 3 * 1024 * 1024;
/** How many rows one page looks at when choosing what fits. */
const PAGE_SCAN = 500;
/** One node's JSON besides its three texts — ids, numbers, field names — rounded up. */
const NODE_OVERHEAD_BYTES = 512;

/** Where the next page starts: the last node sent, in the load's (created_at, id) order. */
export type Cursor = { createdAt: string; id: string };
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(cursor: Cursor): string {
	return `${cursor.createdAt}_${cursor.id}`;
}

export function decodeCursor(value: string): Cursor | null {
	const cut = value.indexOf('_');
	if (cut === -1) return null;
	const createdAt = value.slice(0, cut);
	const id = value.slice(cut + 1);
	return CURSOR_TIME.test(createdAt) && isUuid(id) ? { createdAt, id } : null;
}

/** The rows that go in one page: as many as fit in `budget` bytes, and always at least one. */
export function takePage<T extends { bytes: number }>(rows: readonly T[], budget: number): T[] {
	const page: T[] = [];
	let total = 0;
	for (const row of rows) {
		const size = row.bytes + NODE_OVERHEAD_BYTES;
		if (page.length > 0 && total + size > budget) break;
		page.push(row);
		total += size;
	}
	return page;
}
```

```ts
const NODE_COLUMNS = `id, parent_id, prompt, response, thinking, status, error, usage, model, x, y, position_mode, width, height,
	collapsed, body_collapsed,
	(extract(epoch from created_at) * 1000)::bigint::text as created_ms,
	(extract(epoch from updated_at) * 1000)::bigint::text as updated_ms`;

function fromRow(r: NodeRow): NodeWire {
	return {
		id: r.id,
		parentId: r.parent_id,
		prompt: r.prompt,
		response: r.response,
		thinking: r.thinking,
		status: r.status,
		error: r.error,
		usage: r.usage,
		model: r.model,
		x: r.x,
		y: r.y,
		positionMode: r.position_mode,
		width: r.width,
		height: r.height,
		collapsed: r.collapsed,
		bodyCollapsed: r.body_collapsed,
		createdAt: Number(r.created_ms),
		updatedAt: Number(r.updated_ms)
	};
}

/**
 * One page of the canvas load, in creation order. Which nodes fit is decided from the texts' byte
 * lengths before any text is read, so a page carries at most `budget` bytes of text — or one node
 * bigger than that, alone.
 */
export async function loadNodesPage(
	userId: string,
	after: Cursor | null,
	budget = PAGE_BYTES
): Promise<{ nodes: NodeWire[]; next: Cursor | null }> {
	const scanned = await query<{ id: string; created_iso: string; bytes: number }>(
		`select id,
		        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_iso,
		        (octet_length(prompt) + octet_length(response) + octet_length(thinking))::int as bytes
		   from nodes
		  where user_id = $1 and ($2::timestamptz is null or (created_at, id) > ($2::timestamptz, $3::uuid))
		  order by created_at, id
		  limit ${PAGE_SCAN}`,
		[userId, after?.createdAt ?? null, after?.id ?? null]
	);
	const page = takePage(scanned, budget);
	if (page.length === 0) return { nodes: [], next: null };
	const rows = await query<NodeRow>(
		`select ${NODE_COLUMNS} from nodes where user_id = $1 and id = any($2::uuid[]) order by created_at, id`,
		[userId, page.map((r) => r.id)]
	);
	const last = page[page.length - 1];
	const more = page.length < scanned.length || scanned.length === PAGE_SCAN;
	return { nodes: rows.map(fromRow), next: more ? { createdAt: last.created_iso, id: last.id } : null };
}

export async function loadView(userId: string): Promise<ViewWire | null> {
	const view = await queryOne<{ viewport: ViewWire['viewport']; target_node_id: string | null }>(
		'select viewport, target_node_id from canvas_view where user_id = $1',
		[userId]
	);
	return view ? { viewport: view.viewport, targetNodeId: view.target_node_id } : null;
}

/** Every node and the view, page by page — for the database tests and anything else server-side. */
export async function loadCanvas(userId: string): Promise<{ nodes: NodeWire[]; view: ViewWire | null }> {
	const nodes: NodeWire[] = [];
	let after: Cursor | null = null;
	do {
		const page: { nodes: NodeWire[]; next: Cursor | null } = await loadNodesPage(userId, after);
		nodes.push(...page.nodes);
		after = page.next;
	} while (after !== null);
	return { nodes, view: await loadView(userId) };
}
```

Add the GET handler to `src/routes/api/nodes/+server.ts`, and add `decodeCursor`, `encodeCursor` and `loadNodesPage` to its `$lib/server/nodes` import:

```ts
/** One page of the canvas load. Reads need the session, not the same-origin check (no state changes). */
export const GET = withRoute('nodes.get', async ({ url, locals }) => {
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	const raw = url.searchParams.get('after');
	const after = raw === null ? null : decodeCursor(raw);
	if (raw !== null && !after) throw new ApiError('invalid_request', 'That page cursor is malformed.');
	const page = await loadNodesPage(user.id, after);
	return json(
		{ nodes: page.nodes, next: page.next && encodeCursor(page.next) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
});
```

Replace `src/routes/canvas/+page.server.ts`:

```ts
import { getKeySummary } from '$lib/server/keys';
import { loadView } from '$lib/server/nodes';
import { DEFAULT_MODEL_ID, MODELS } from '$lib/shared/models';
import type { PageServerLoad } from './$types';

/**
 * A server load also makes the hook's sign-in guard run on client-side navigation. The nodes are
 * not here: the browser fetches them page by page from GET /api/nodes, so no canvas is too big to open.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // hooks.server.ts redirects signed-out requests
	const [view, key] = await Promise.all([loadView(user.id), getKeySummary(user.id)]);
	return { view, hasKey: key !== null, email: user.email, models: MODELS, defaultModelId: DEFAULT_MODEL_ID };
};
```

- [ ] **Step 4: Implement the browser side**

Create `src/lib/canvas/load.ts`:

```ts
import type { NodeWire } from './node-wire';

/** One page of `GET /api/nodes`. */
export type NodesPage = { nodes: NodeWire[]; next: string | null };

/** No real canvas needs this many 3 MiB pages; a server that never says "done" must not hang the tab. */
export const MAX_PAGES = 1000;

/** The whole canvas, page by page, in creation order (parents before children). */
export async function loadAllNodes(fetchPage: (after: string | null) => Promise<NodesPage>): Promise<NodeWire[]> {
	const nodes: NodeWire[] = [];
	let after: string | null = null;
	for (let i = 0; i < MAX_PAGES; i++) {
		const page = await fetchPage(after);
		nodes.push(...page.nodes);
		if (page.next === null) return nodes;
		after = page.next;
	}
	throw new Error('The canvas has more pages than the loader allows.');
}
```

Create `src/lib/components/canvas/CanvasLoader.svelte`:

```svelte
<!-- Fetches the canvas page by page, then hands the nodes to the app. §4.11: past 5 s, say so. -->
<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/canvas/api-client';
	import { copy } from '$lib/canvas/copy';
	import { loadAllNodes, type NodesPage } from '$lib/canvas/load';
	import type { NodeWire, ViewWire } from '$lib/canvas/node-wire';
	import type { ModelSpec } from '$lib/shared/models';
	import '$lib/styles/canvas-tokens.css';
	import CanvasApp from './CanvasApp.svelte';

	type Data = { view: ViewWire | null; email: string; models: readonly ModelSpec[]; defaultModelId: string };
	let { data }: { data: Data } = $props();

	const SLOW_MS = 5000;
	let nodes = $state.raw<NodeWire[] | null>(null);
	let failed = $state(false);
	let slow = $state(false);

	async function load() {
		failed = false;
		slow = false;
		const timer = setTimeout(() => (slow = true), SLOW_MS);
		try {
			nodes = await loadAllNodes((after) =>
				apiFetch<NodesPage>(after === null ? '/api/nodes' : `/api/nodes?after=${encodeURIComponent(after)}`)
			);
		} catch {
			failed = true;
		} finally {
			clearTimeout(timer);
		}
	}

	onMount(() => {
		void load();
	});
</script>

{#if nodes}
	<SvelteFlowProvider><CanvasApp {data} {nodes} /></SvelteFlowProvider>
{:else}
	<div class="loading canvas-surface" role="status">
		{#if failed || slow}<p>{copy('canvas.loadError')}</p>{/if}
		{#if failed}<button type="button" onclick={() => void load()}>{copy('canvas.loadRetry')}</button>{/if}
	</div>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		height: 100vh;
		background: var(--cy-paper);
		color: var(--cy-ink);
		font: var(--text-sm);
	}
	p {
		margin: 0;
	}
	button {
		font: inherit;
		color: var(--cy-ink);
		background: var(--cy-paper-lift);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
</style>
```

In `src/lib/components/canvas/CanvasApp.svelte`, the nodes now arrive as their own prop:
- `type Data = { view: ViewWire | null; email: string; models: readonly ModelSpec[]; defaultModelId: string };`
- `let { data, nodes }: { data: Data; nodes: NodeWire[] } = $props();`
- `const store = untrack(() => new CanvasStore({ nodes, view: data.view, model: initialModel() }));`

`src/routes/canvas/+page.svelte` becomes:

```svelte
<script lang="ts">
	import CanvasLoader from '$lib/components/canvas/CanvasLoader.svelte';
	import EmptyState from '$lib/components/canvas/EmptyState.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>

{#if data.hasKey}
	<CanvasLoader {data} />
{:else}
	<EmptyState variant="no-key" />
{/if}
```

- [ ] **Step 5: Seed option and shared browser helpers**

In `tests/support/seed-server.ts`:
- Add `thinkingChars?: number` to `SeedRequest`. The `seedUser` signature becomes `({ key = true, nodes = 0, chatUsed = 0, thinkingChars = 0 }: SeedRequest)`.
- The node insert writes a `thinking` column:

```ts
		await query(
			`insert into nodes (id, user_id, parent_id, prompt, response, thinking, status, x, y, position_mode, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 'complete', $7, $8, 'auto', now() + ($9 || ' milliseconds')::interval, now())`,
			[
				id,
				userId,
				parentId,
				`Seeded question ${i + 1}`,
				'Seeded answer. '.repeat(20 + (i % 5) * 12),
				thinkingChars > 0 ? 'Seeded reasoning. '.repeat(Math.ceil(thinkingChars / 18)).slice(0, thinkingChars) : '',
				(i % 10) * 520,
				Math.floor(i / 10) * 420,
				String(i)
			]
		);
```

Create `tests/e2e/helpers.ts`. It is the one copy of the helpers `interaction.spec.ts` and `canvas.spec.ts` each define today:

```ts
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export const cards = (page: Page) => page.locator('article[data-node-id]');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends from the composer and returns the new card's id. Sending always points the composer at the new
 * node; counting or picking cards from the DOM would not do, because Svelte Flow renders only the cards
 * in view, in its own order.
 */
export async function send(page: Page, prompt: string, { wait = true }: { wait?: boolean } = {}): Promise<string> {
	const target = page.getByTestId('composer-target');
	const previous = await target.getAttribute('data-target-id');
	await page.getByLabel('Message').fill(prompt);
	await page.getByLabel('Message').press('Enter');
	await expect(target).not.toHaveAttribute('data-target-id', previous ?? '');
	const id = (await target.getAttribute('data-target-id'))!;
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toBeVisible();
	if (wait) await expect(card).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
	return id;
}

/** Every saved node as the canvas load fetches them, page by page, as JSON text — for `toContain` waits. */
export async function savedNodesText(page: Page): Promise<string> {
	const parts: string[] = [];
	let after: string | null = null;
	do {
		const res = await page.request.get(after === null ? '/api/nodes' : `/api/nodes?after=${encodeURIComponent(after)}`);
		const body = (await res.json()) as { nodes: unknown[]; next: string | null };
		parts.push(JSON.stringify(body.nodes));
		after = body.next;
	} while (after !== null);
	return parts.join('\n');
}

export async function viewport(page: Page) {
	// DOMMatrixReadOnly is a browser global, so the parse has to run inside the page.
	return page.locator('.svelte-flow__viewport').evaluate((el) => {
		const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
		return { x: Math.round(m.e), y: Math.round(m.f), zoom: Math.round(m.a * 1000) / 1000 };
	});
}

/** Resolves once the viewport has stopped moving (the follow animation that frames a new card). */
export async function settled(page: Page) {
	let last = JSON.stringify(await viewport(page));
	for (let stable = 0; stable < 3; ) {
		await sleep(150);
		const now = JSON.stringify(await viewport(page));
		stable = now === last ? stable + 1 : 0;
		last = now;
	}
}

export async function emptyCanvasPoint(page: Page) {
	const point = await page.evaluate(() => {
		const pane = document.querySelector('.svelte-flow__pane')!;
		const r = pane.getBoundingClientRect();
		for (let y = r.top + 60; y < r.bottom - 60; y += 29)
			for (let x = r.left + 60; x < r.right - 260; x += 41)
				if (document.elementFromPoint(x, y)?.classList.contains('svelte-flow__pane')) return { x, y };
		return null;
	});
	if (!point) throw new Error('no empty canvas point on screen');
	return point;
}

export async function fit(page: Page) {
	await page.getByRole('button', { name: 'Fit', exact: true }).click();
	await sleep(400);
}
```

Then point the specs at the helpers:
- **`tests/e2e/interaction.spec.ts`.**
  - Delete its local `cards`, `sleep`, `send`, `viewport`, `settled`, `emptyCanvasPoint` and `fit`, and import them from `./helpers`.
  - Change its two `send(page, …, false)` calls to `send(page, …, { wait: false })`.
  - The drag test's save wait becomes `await expect.poll(() => savedNodesText(page)).toContain('"manual"');`.
- **`tests/e2e/canvas.spec.ts`.**
  - Delete its local `cards` and `send`, which picked the new card with `cards.last()`, and import `cards`, `send` and `savedNodesText` from `./helpers`.
  - `waitSaved` becomes `await expect.poll(() => savedNodesText(page), { timeout: 15_000 }).toContain(needle);`.
- **`tests/e2e/nodes-api.spec.ts`.**
  - The two `__data.json` reads become `savedNodesText(page)`. Import it, with `fit`, from `./helpers`.
  - Append:

```ts
test('a canvas larger than one load page arrives whole', async ({ page, signIn }) => {
	await signIn({ nodes: 9, thinkingChars: 390_000 }); // ~3.5 MB of text: two pages
	const pageRequests: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/nodes') pageRequests.push(r.url());
	});
	await page.goto('/canvas');
	await expect(page.locator('article[data-node-id]').first()).toBeVisible();
	expect(pageRequests.length).toBeGreaterThanOrEqual(2);
	await fit(page);
	await expect(page.locator('article[data-node-id]')).toHaveCount(9);
});

test('the canvas load refuses a signed-out reader and a malformed cursor', async ({ page, signIn }) => {
	expect((await page.request.get('/api/nodes')).status()).toBe(401);
	await signIn();
	expect((await page.request.get('/api/nodes?after=nope')).status()).toBe(400);
});
```

- [ ] **Step 6: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e`
Expected: everything passes.
- New tests: 2 unit tests in `nodes.test`, 2 in `load.test`, 2 database tests, and 2 browser tests.
- Every existing browser test still passes. The specs now read saved state from `GET /api/nodes`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/nodes.ts src/lib/server/nodes.test.ts src/lib/server/nodes.dbtest.ts src/routes/api/nodes/+server.ts src/routes/canvas src/lib/canvas/load.ts src/lib/canvas/load.test.ts src/lib/components/canvas/CanvasLoader.svelte src/lib/components/canvas/CanvasApp.svelte tests/support/seed-server.ts tests/e2e
git commit -m "feat(canvas): load the canvas in pages, so no canvas is too big to open

The page data carried every node's full text, and Vercel caps a function
response at 4.5 MB. The browser now fetches GET /api/nodes page by page
(at most 3 MiB of text each, chosen from byte lengths before any text is
read) and builds the store when it has them all.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: A ping before the first token, and the relay's remaining checks

Cutover blocker M4. The relay forwards only content deltas. Adaptive thinking can run past 60 s before the first summary delta arrives, and the first-token watchdog would then report "Timed out" while Anthropic is still working.

Anthropic sends `message_start` as soon as the model starts. The relay turns it into a `{ type: 'ping' }` frame, and any frame resets the watchdog. Once the first frame arrives the watchdog is cleared for that stream, so later silences cannot trip it.

This task also adds the two relay checks Plan 2 left untested: an error part-way through a reply, and the 2 MB body cap.

**Files:**
- Modify: `src/lib/shared/chat-types.ts`, `src/lib/server/anthropic.ts`, `src/lib/server/anthropic.test.ts`
- Modify: `src/lib/canvas/store.svelte.ts` (ignore pings in `apply`)
- Modify: `tests/support/fake-anthropic.ts` (`[midfail]` marker), `tests/e2e/chat-api.spec.ts`

**Interfaces:**
- **Consumes:**
  - The server `streamChat` generator.
  - The store's `apply(id, event)`.
  - The fake's `plan()` and `streamMessage()`.
- **Produces:**
  - `ChatStreamEvent` gains `| { type: 'ping' }`.
  - The server `streamChat` yields exactly one ping, first, on `message_start`.
  - The fake marker `[midfail]` sends 5 text deltas, then an Anthropic `error` event (`overloaded_error`). The relay maps it to `{ type: 'error', code: 'provider_unavailable' }`.

- [ ] **Step 1: Write the failing tests**

Append to the `streamChat` describe in `src/lib/server/anthropic.test.ts`:

```ts
	it('signals that the model has started before any text arrives', async () => {
		const events = await collect('claude-opus-5-5', 'hello');
		assert.deepEqual(events[0], { type: 'ping' });
		assert.equal(events.filter((e) => e.type === 'ping').length, 1);
	});

	it('turns an error part-way through the reply into an error event after the text so far', async () => {
		const events = await collect('claude-opus-5-5', '[midfail] break');
		assert.ok(events.some((e) => e.type === 'text'));
		const last = events.at(-1);
		assert.equal(last?.type, 'error');
		assert.equal(last?.type === 'error' && last.code, 'provider_unavailable');
	});
```

In `tests/e2e/chat-api.spec.ts`:
- Add this helper at the top: `const frames = (raw: string) => raw.split('\n\n').filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6)));`
- In the first test, add `expect(text).toContain('"type":"ping"');` next to the other `toContain` checks.
- Append:

```ts
test('an error part-way through arrives as an error frame after the text so far', async ({ page, signIn }) => {
	await signIn();
	const res = await page.request.post('/api/chat', { data: { ...body, messages: [{ role: 'user', content: '[midfail] break' }] } });
	expect(res.status()).toBe(200);
	const events = frames(await res.text());
	expect(events.some((e) => e.type === 'text')).toBe(true);
	expect(events.at(-1)).toMatchObject({ type: 'error', code: 'provider_unavailable' });
});

test('a request body over 2 MB is refused before it reaches Anthropic', async ({ page, signIn }) => {
	await signIn();
	await resetAnthropic();
	const res = await page.request.post('/api/chat', {
		data: { ...body, messages: [{ role: 'user', content: 'x'.repeat(2_100_000) }] }
	});
	expect(res.status()).toBe(413);
	expect((await res.json()).error.code).toBe('payload_too_large');
	expect(res.headers()['ratelimit-limit']).toBe('60');
	expect(await anthropicRequests()).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — no ping event; `[midfail]` streams a normal reply.

- [ ] **Step 3: Implement**

`src/lib/shared/chat-types.ts`: add the variant at the top of the union:

```ts
	/** The model has started (Anthropic's message_start). Carries nothing; it keeps the first-token watchdog quiet. */
	| { type: 'ping' }
```

In `src/lib/server/anthropic.ts`, the start of the `for await` loop in `streamChat` becomes:

```ts
		for await (const event of stream) {
			if (event.type === 'message_start') {
				yield { type: 'ping' };
				continue;
			}
			if (event.type !== 'content_block_delta') continue;
```

In `src/lib/canvas/store.svelte.ts`, `apply` must not treat the ping as the "otherwise it is an error" case. Its first line becomes:

```ts
		if (event.type === 'ping') return; // the model started; onEvent already called activity()
```

In `tests/support/fake-anthropic.ts`:
- `plan()` returns one more field: `failAfter: prompt.includes('[midfail]') ? 5 : null`.
- The text loop in `streamMessage` becomes:

```ts
	const pieces = chunks(p.text, p.wordsPerDelta);
	for (const [i, piece] of pieces.entries()) {
		if (closed) return;
		if (p.failAfter !== null && i === p.failAfter) {
			sse(res, 'error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
			return res.end();
		}
		sse(res, 'content_block_delta', {
			type: 'content_block_delta',
			index,
			delta: { type: 'text_delta', text: piece }
		});
		await sleep(p.tokenMs);
	}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS. There are 2 new `anthropic` tests and 2 new `chat-api` tests. Existing tests that count events still pass, because the abort test aborts after 3 events and the ping is one of them.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shared/chat-types.ts src/lib/server/anthropic.ts src/lib/server/anthropic.test.ts src/lib/canvas/store.svelte.ts tests/support/fake-anthropic.ts tests/e2e/chat-api.spec.ts
git commit -m "feat(chat): relay a ping when the model starts, so long thinking never times out

The first-token watchdog only saw content deltas, so an adaptive-thinking
phase over 60 s read as \"Timed out\" while Anthropic was still working.
The provider key is untouched: it lives only in provider_keys.ciphertext,
AES-256-GCM under KEY_VAULT_ENCRYPTION_KEY with AAD \"<userId>:anthropic\";
a database read still yields nothing usable.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Markdown that parses only what changed, and lists that read right

Cutover blocker I2. `Markdown.svelte` re-parses the whole reply on every streamed chunk. At 300 KB that is 2.8 ms a parse, and a long reply arrives in thousands of chunks.

`MarkdownStream` keeps the blocks before the last blank line that no code fence spans, and parses only the rest. Its output is always exactly `parseMarkdown(text)`, and a property test pins that.

While the parser is open, three list fixes from Plan 2's deferred list go in, each with a test:
- A numbered list split by blank lines keeps its numbering through an `<ol start>`.
- A lead-in line directly above a list becomes its own paragraph.
- Nested or mixed item markers are stripped instead of shown.

**Files:**
- Modify: `src/lib/canvas/markdown.ts`, `src/lib/canvas/markdown.test.ts`, `src/lib/components/canvas/Markdown.svelte`

**Interfaces:**
- Consumes: `parseMarkdown`, `parseInline`, `Block`, `Inline` (Plan 2).
- **Produces:**
  - `Block`'s list variant gains `start?: number`, present only for an ordered list that does not start at 1.
  - `class MarkdownStream { update(text: string): Block[]; parsedChars: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/canvas/markdown.test.ts`, and add `MarkdownStream` to its import:

```ts
describe('lists', () => {
	it('keeps the numbering of a list split by blank lines', () => {
		assert.deepEqual(parseMarkdown('1. Fork\n\n2. Rootline\n\n3. Grow'), [
			{ kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'Fork' }]] },
			{ kind: 'list', ordered: true, start: 2, items: [[{ kind: 'text', text: 'Rootline' }]] },
			{ kind: 'list', ordered: true, start: 3, items: [[{ kind: 'text', text: 'Grow' }]] }
		]);
	});

	it('splits a lead-in line from the list under it', () => {
		assert.deepEqual(parseMarkdown('Options:\n- one\n- two'), [
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Options:' }] },
			{ kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] }
		]);
	});

	it('strips markers from nested and mixed items instead of showing them', () => {
		const [list] = parseMarkdown('1. Parent\n   - child\n2. Next');
		assert.deepEqual(list, {
			kind: 'list',
			ordered: true,
			items: [[{ kind: 'text', text: 'Parent' }], [{ kind: 'text', text: 'child' }], [{ kind: 'text', text: 'Next' }]]
		});
	});
});

describe('MarkdownStream', () => {
	const samples = [
		'Intro paragraph.\n\nSecond one with **bold** and `code`.\n\n1. one\n2. two\n\n- a\n- b',
		'Before.\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\nAfter the fence.\n\nMore.',
		'Text ``` mid-line on purpose\n\n```\nopen fence that never closes\n\nstill inside',
		'Para one\nwrapped line.\n\n\n\nAfter several blank lines.\n\n**bold across\n\nblank** stays text.'
	];
	for (const [n, sample] of samples.entries()) {
		it(`matches a full parse at every step, whatever the chunk size (sample ${n + 1})`, () => {
			for (const size of [1, 3, 16, 97]) {
				const stream = new MarkdownStream();
				for (let end = size; end < sample.length + size; end += size) {
					const prefix = sample.slice(0, Math.min(end, sample.length));
					assert.deepEqual(stream.update(prefix), parseMarkdown(prefix), `size ${size}, at ${prefix.length}`);
				}
			}
		});
	}

	it('starts over when the text is not an extension of the last one', () => {
		const stream = new MarkdownStream();
		stream.update('First.\n\nSecond.');
		assert.deepEqual(stream.update('Other.'), parseMarkdown('Other.'));
	});

	it('re-parses only the unfinished tail as a long reply streams in', () => {
		const reply = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} with a few words in it.`).join('\n\n');
		const stream = new MarkdownStream();
		let most = 0;
		for (let end = 16; end < reply.length; end += 16) {
			stream.update(reply.slice(0, end));
			most = Math.max(most, stream.parsedChars);
		}
		assert.ok(most < 200, `largest single parse was ${most} characters`);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL. `MarkdownStream` is not exported, and the list tests fail on the old parser.

- [ ] **Step 3: Implement** — `src/lib/canvas/markdown.ts` becomes:

```ts
/**
 * The four constructs replies need — paragraphs, fenced code, lists, inline
 * **bold** / `code` — parsed into plain data. The component renders these
 * with text interpolation only, so nothing a model writes can become markup.
 */
export type Inline = { kind: 'text' | 'strong' | 'code'; text: string };

export type Block =
	| { kind: 'paragraph'; inline: Inline[] }
	/** `start` only when an ordered list does not begin at 1 (a list split by blank lines keeps counting). */
	| { kind: 'list'; ordered: boolean; start?: number; items: Inline[][] }
	| { kind: 'code'; text: string };

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const ORDERED_ITEM = /^\s*(\d+)\.\s+(.*)$/;
const ANY_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;
const BLANK = /\n[ \t]*\n/g;

export function parseInline(text: string): Inline[] {
	return text
		.split(INLINE)
		.filter((part) => part !== '')
		.map((part): Inline => {
			if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { kind: 'strong', text: part.slice(2, -2) };
			if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { kind: 'code', text: part.slice(1, -1) };
			return { kind: 'text', text: part };
		});
}

/**
 * One blank-line-separated chunk of prose: runs of item lines become a list (any marker, at any
 * indent — nested items are flattened), and the lines between them become paragraphs.
 */
function parseProse(chunk: string): Block[] {
	const lines = chunk.split('\n').filter((line) => line.trim() !== '');
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		if (ANY_ITEM.test(lines[i])) {
			const first = lines[i].match(ORDERED_ITEM);
			const items: Inline[][] = [];
			while (i < lines.length && ANY_ITEM.test(lines[i])) items.push(parseInline(lines[i++].match(ANY_ITEM)![1]));
			const start = first ? Number(first[1]) : 1;
			blocks.push(first && start !== 1 ? { kind: 'list', ordered: true, start, items } : { kind: 'list', ordered: !!first, items });
		} else {
			const paragraph: string[] = [];
			while (i < lines.length && !ANY_ITEM.test(lines[i])) paragraph.push(lines[i++]);
			blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
		}
	}
	return blocks;
}

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	const pushProse = (segment: string) => {
		for (const chunk of segment.split(/\n\s*\n/)) blocks.push(...parseProse(chunk));
	};
	let cursor = 0;
	FENCE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FENCE.exec(text)) !== null) {
		pushProse(text.slice(cursor, match.index));
		blocks.push({ kind: 'code', text: match[1].replace(/\n$/, '') });
		cursor = FENCE.lastIndex;
	}
	pushProse(text.slice(cursor));
	return blocks;
}

/**
 * `parseMarkdown` for text that only grows — a reply as it streams. Everything up to the last blank
 * line that no code fence spans (or the end of the last closed fence) is parsed once and kept; each
 * update parses only what follows. Cutting there is safe because `parseMarkdown` never lets a block
 * cross a blank line outside a fence. The result is always exactly `parseMarkdown(text)`.
 */
export class MarkdownStream {
	private source = '';
	/** text[0, boundary) is parsed, and its blocks are `stable`. */
	private boundary = 0;
	private stable: Block[] = [];
	/** End of the last closed code fence: no fence before it can change. */
	private fenceEnd = 0;
	/** Characters parsed by the last update — for tests: appending must not re-parse the whole reply. */
	parsedChars = 0;

	update(text: string): Block[] {
		if (!text.startsWith(this.source)) {
			this.boundary = 0;
			this.stable = [];
			this.fenceEnd = 0;
		}
		this.source = text;
		this.parsedChars = 0;
		const cut = this.safeCut(text);
		if (cut > this.boundary) {
			this.stable = [...this.stable, ...parseMarkdown(text.slice(this.boundary, cut))];
			this.parsedChars += cut - this.boundary;
			this.boundary = cut;
		}
		const tail = parseMarkdown(text.slice(this.boundary));
		this.parsedChars += text.length - this.boundary;
		return tail.length > 0 ? [...this.stable, ...tail] : this.stable;
	}

	/** The furthest point the text can be cut so that both halves parse as the whole does. */
	private safeCut(text: string): number {
		FENCE.lastIndex = this.fenceEnd;
		while (FENCE.exec(text) !== null) this.fenceEnd = FENCE.lastIndex;
		// A fence that has opened but not closed may still swallow anything after it.
		const opener = text.indexOf('```', this.fenceEnd);
		const limit = opener === -1 ? text.length : opener;
		const from = Math.max(this.boundary, this.fenceEnd);
		const region = text.slice(from, limit);
		let cut = -1;
		BLANK.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = BLANK.exec(region)) !== null) cut = match.index + match[0].length;
		return cut === -1 ? from : from + cut;
	}
}
```

In `src/lib/components/canvas/Markdown.svelte`:
- The script becomes:

```svelte
<script lang="ts">
	import { MarkdownStream, type Inline } from '$lib/canvas/markdown';

	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();
	// One parser per card: as the reply grows, only its unfinished tail is parsed again.
	const stream = new MarkdownStream();
	const blocks = $derived(stream.update(text));
	const caretInline = $derived(streaming && blocks.at(-1)?.kind === 'paragraph');
</script>
```

- The ordered list is rendered as `<ol start={block.start}>`.
- Add `overflow-wrap: anywhere;` to the `.md` rule, so a long unbroken token wraps instead of overflowing the card.

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test`
Expected: PASS. The 8 existing markdown tests still pass, plus 3 list tests and 6 `MarkdownStream` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/markdown.ts src/lib/canvas/markdown.test.ts src/lib/components/canvas/Markdown.svelte
git commit -m "perf(canvas): parse only the unfinished tail of a streaming reply

A 300 KB reply took 2.8 ms per chunk to re-parse in full. Blocks before the
last blank line outside a code fence are kept; a property test pins the
result to the full parse at every chunk size. Numbered lists split by blank
lines keep their numbers, a lead-in line splits from its list, and nested
markers no longer show.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---
### Task 4: Graph and navigation helpers

These are pure functions that the store and the keyboard handler will call. They cover:
- the canvas structure: children, and which cards a collapse hides;
- taking a branch out for Undo, and putting it back;
- when Retry, Continue and Regenerate apply;
- tree moves for arrows, Home and End over the cards that are drawn.

There is also a test file for the carried viewport maths that Plan 3 starts to rely on. No UI changes in this task.

**Files:**
- Modify: `src/lib/canvas/graph.ts`
- Create: `src/lib/canvas/graph-structure.test.ts`, `src/lib/canvas/navigation.ts`, `src/lib/canvas/navigation.test.ts`, `src/lib/canvas/viewport.test.ts`

**Interfaces:**
- **Consumes.** From `graph.ts`: `childIds`, `rootIds`, `descendantIds`, `pathToRoot`, `removeBranch`, `placeNode`, `setCollapsed`, `canBranchFrom`. From `viewport.ts`: `zoomAt`, `rectInView`, `focusOn`, `ZOOM_MIN`, `ZOOM_MAX`.
- **Produces, from `graph.ts`:**
  - `CONTINUE_PROMPT = "Continue from where you left off."`
  - `type GraphStructure = { children: ReadonlyMap<string | null, readonly string[]>; hidden: ReadonlySet<string> }`
  - `graphStructure(graph): GraphStructure`
  - `hiddenIds(graph): ReadonlySet<string>`
  - `visibleGraph(graph): ConversationGraph`
  - `adoptPositions(graph, from, now?): ConversationGraph`
  - `expandPath(graph, nodeId, now?): ConversationGraph`
  - `extractBranch(graph, nodeId): { graph; removed: ConversationNode[] }`
  - `restoreBranch(graph, removed): ConversationGraph`, which throws when the branch's parent is gone or an id is already present
  - `canRetry(graph, nodeId): boolean`
  - `canContinue(node): boolean`
  - `canRegenerate(graph, nodeId): boolean`
- **Produces, from `navigation.ts`:**
  - `type FocusMove = 'parent' | 'child' | 'prev' | 'next' | 'first' | 'last'`
  - `moveFocus(graph, from: string | null, move): string | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/canvas/graph-structure.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	addNode,
	adoptPositions,
	appendText,
	canContinue,
	canRegenerate,
	canRetry,
	completeNode,
	createGraph,
	expandPath,
	extractBranch,
	failNode,
	graphStructure,
	interruptNode,
	placeNode,
	restoreBranch,
	setCollapsed,
	startStreaming,
	visibleGraph,
	type ConversationGraph
} from './graph';

let clock = 1;
/** A node with an answer, so it can be branched from. Creation times increase in call order. */
function answered(graph: ConversationGraph, id: string, parentId: string | null = null): ConversationGraph {
	const now = clock++;
	const added = addNode(graph, { id, prompt: `${id}?`, parentId, position: { x: 0, y: 0 }, now });
	return completeNode(appendText(startStreaming(added.graph, id, now), id, `${id}!`, now), id, null, now);
}

/** r → a → b, r → c, and a second root s. */
function tree(): ConversationGraph {
	let g = answered(createGraph(), 'r');
	g = answered(g, 'a', 'r');
	g = answered(g, 'b', 'a');
	g = answered(g, 'c', 'r');
	return answered(g, 's');
}

describe('graph structure', () => {
	it('lists children in creation order, roots under null', () => {
		const { children } = graphStructure(tree());
		assert.deepEqual(children.get(null), ['r', 's']);
		assert.deepEqual(children.get('r'), ['a', 'c']);
		assert.deepEqual(children.get('a'), ['b']);
	});

	it('hides everything under a collapsed node, but not the node itself', () => {
		const g = setCollapsed(tree(), 'r', true);
		assert.deepEqual([...graphStructure(g).hidden].sort(), ['a', 'b', 'c']);
		assert.deepEqual(visibleGraph(g).nodeIds, ['r', 's']);
	});

	it('hides a nested collapsed subtree once, under the outer collapse', () => {
		const g = setCollapsed(setCollapsed(tree(), 'a', true), 'r', true);
		assert.deepEqual([...graphStructure(g).hidden].sort(), ['a', 'b', 'c']);
	});

	it('copies laid-out positions back into the full graph', () => {
		const g = setCollapsed(tree(), 'a', true);
		const laidOut = placeNode(visibleGraph(g), 'c', { x: 500, y: 40 });
		const merged = adoptPositions(g, laidOut);
		assert.deepEqual(merged.nodesById.c.position, { x: 500, y: 40 });
		assert.equal(merged.nodesById.b, g.nodesById.b, 'a hidden node is left alone');
	});

	it('expands every collapsed node on the way to a node', () => {
		const g = expandPath(setCollapsed(setCollapsed(tree(), 'r', true), 'a', true), 'b');
		assert.equal(g.nodesById.r.collapsed, false);
		assert.equal(g.nodesById.a.collapsed, false);
	});
});

describe('extract and restore a branch', () => {
	it('takes a node and its subtree out, parents first, and puts them back exactly', () => {
		const g = tree();
		const { graph, removed } = extractBranch(g, 'a');
		assert.deepEqual(removed.map((n) => n.id), ['a', 'b']);
		assert.deepEqual(graph.nodeIds, ['r', 'c', 's']);
		const back = restoreBranch(graph, removed);
		assert.deepEqual(back.nodeIds, g.nodeIds);
		assert.equal(back.nodesById.b, g.nodesById.b);
	});

	it('refuses to restore under a parent that is gone, or over a node already there', () => {
		const { graph, removed } = extractBranch(tree(), 'a');
		assert.throws(() => restoreBranch(extractBranch(graph, 'r').graph, removed), /gone/);
		assert.throws(() => restoreBranch(tree(), removed), /already/);
	});
});

describe('retry, continue and regenerate', () => {
	it('retries only a failed card with no replies', () => {
		let g = answered(createGraph(), 'r');
		g = failNode(startStreaming(addNode(g, { id: 'x', prompt: 'x', parentId: 'r', position: { x: 0, y: 0 } }).graph, 'x'), 'x', {
			code: 'provider_unavailable',
			message: 'no'
		});
		assert.equal(canRetry(g, 'x'), true);
		assert.equal(canRetry(g, 'r'), false, 'a complete card is not retried');
		g = appendText(g, 'x', 'partial');
		g = addNode(g, { id: 'y', prompt: 'y', parentId: 'x', position: { x: 0, y: 0 } }).graph;
		assert.equal(canRetry(g, 'x'), false, 'its replies answered the text it has');
	});

	it('continues only a stopped card that has text', () => {
		const g = answered(createGraph(), 'r');
		const stopped = interruptNode(g, 'r');
		assert.equal(canContinue(stopped.nodesById.r), true);
		assert.equal(canContinue(g.nodesById.r), false);
		assert.equal(canContinue(interruptNode(startStreaming(g, 'r'), 'r').nodesById.r), false, 'no text, nothing to continue');
	});

	it('regenerates any card that is not still streaming', () => {
		const g = tree();
		assert.equal(canRegenerate(g, 'b'), true);
		assert.equal(canRegenerate(startStreaming(g, 'b'), 'b'), false);
		assert.equal(canRegenerate(g, 'missing'), false);
	});
});
```

`src/lib/canvas/navigation.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addNode, appendText, completeNode, createGraph, setCollapsed, startStreaming, type ConversationGraph } from './graph';
import { moveFocus } from './navigation';

let clock = 1;
function answered(graph: ConversationGraph, id: string, parentId: string | null = null): ConversationGraph {
	const now = clock++;
	const added = addNode(graph, { id, prompt: id, parentId, position: { x: 0, y: 0 }, now });
	return completeNode(appendText(startStreaming(added.graph, id, now), id, id, now), id, null, now);
}

/** r → a → b, r → c (created after b), and a second root s (created last). */
function tree(): ConversationGraph {
	let g = answered(createGraph(), 'r');
	g = answered(g, 'a', 'r');
	g = answered(g, 'b', 'a');
	g = answered(g, 'c', 'r');
	return answered(g, 's');
}

describe('moveFocus', () => {
	it('moves to the parent, the first child, and the siblings either side', () => {
		const g = tree();
		assert.equal(moveFocus(g, 'b', 'parent'), 'a');
		assert.equal(moveFocus(g, 'r', 'child'), 'a');
		assert.equal(moveFocus(g, 'a', 'next'), 'c');
		assert.equal(moveFocus(g, 'c', 'prev'), 'a');
		assert.equal(moveFocus(g, 'r', 'next'), 's', 'roots are siblings');
	});

	it('stays put at the ends instead of wrapping', () => {
		const g = tree();
		assert.equal(moveFocus(g, 'r', 'parent'), null);
		assert.equal(moveFocus(g, 'b', 'child'), null);
		assert.equal(moveFocus(g, 'a', 'prev'), null);
		assert.equal(moveFocus(g, 's', 'next'), null);
	});

	it('goes to the first root on Home and to the newest leaf on End', () => {
		const g = tree();
		assert.equal(moveFocus(g, 'b', 'first'), 'r');
		assert.equal(moveFocus(g, 'r', 'last'), 's');
		assert.equal(moveFocus(answered(g, 'd', 'b'), 'r', 'last'), 'd');
	});

	it('never lands on a hidden card', () => {
		const g = setCollapsed(tree(), 'a', true);
		assert.equal(moveFocus(g, 'a', 'child'), null, 'a collapsed card has no child to go to');
		assert.equal(moveFocus(setCollapsed(tree(), 'r', true), 's', 'last'), 's');
		assert.equal(moveFocus(g, 'b', 'parent'), 'r', 'from a hidden card, start again at the first root');
	});

	it('starts at the first root when nothing is focused', () => {
		assert.equal(moveFocus(tree(), null, 'child'), 'r');
		assert.equal(moveFocus(createGraph(), null, 'first'), null);
	});
});
```

`src/lib/canvas/viewport.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — the new graph exports and `./navigation` do not exist (the viewport tests pass already; they pin carried behaviour Plan 3 now depends on).

- [ ] **Step 3: Implement**

In `src/lib/canvas/graph.ts`:
- Replace the last paragraph of the file's header comment, the one that says "so a React `useState` holding one of these behaves correctly…", with the text below. The rest of the header stays.

```ts
 * Every mutation returns a new graph and leaves the input untouched, so the
 * store can hold it in `$state.raw` and replace it whole. Node objects are
 * shared by reference where they did not change, so a card only re-renders
 * when its own node did.
```

- Add these after `canBranchFrom`:

```ts
/** What Continue sends: the model picks up an interrupted reply, in a new card below it (the old app's wording). */
export const CONTINUE_PROMPT = "Continue from where you left off.";

export type GraphStructure = {
  /** Parent id → child ids in creation order; roots are listed under `null`. */
  children: ReadonlyMap<string | null, readonly string[]>;
  /** Ids under a collapsed node: not drawn. A collapsed node itself is drawn. */
  hidden: ReadonlySet<string>;
};

/** Children and the hidden set in one pass, for callers that would otherwise ask per node. */
export function graphStructure(graph: ConversationGraph): GraphStructure {
  const children = new Map<string | null, string[]>();
  for (const id of graph.nodeIds) {
    const parent = graph.nodesById[id].parentId;
    const list = children.get(parent);
    if (list) list.push(id);
    else children.set(parent, [id]);
  }
  const hidden = new Set<string>();
  const hide = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      hide(child);
    }
  };
  for (const id of graph.nodeIds) if (graph.nodesById[id].collapsed) hide(id);
  return { children, hidden };
}

export function hiddenIds(graph: ConversationGraph): ReadonlySet<string> {
  return graphStructure(graph).hidden;
}

/** The graph without its hidden nodes: what the canvas draws, and what Tidy lays out. */
export function visibleGraph(graph: ConversationGraph): ConversationGraph {
  const { hidden } = graphStructure(graph);
  if (hidden.size === 0) return graph;
  const nodeIds = graph.nodeIds.filter((id) => !hidden.has(id));
  const nodesById: Record<string, ConversationNode> = {};
  for (const id of nodeIds) nodesById[id] = graph.nodesById[id];
  return { nodesById, nodeIds };
}

/** Copies positions from a laid-out copy (e.g. `tidyLayout(visibleGraph(g))`) back into the full graph. */
export function adoptPositions(
  graph: ConversationGraph,
  from: ConversationGraph,
  now?: number,
): ConversationGraph {
  let next = graph;
  for (const id of from.nodeIds) {
    const current = graph.nodesById[id];
    const position = from.nodesById[id].position;
    if (current && (current.position.x !== position.x || current.position.y !== position.y)) {
      next = placeNode(next, id, position, now);
    }
  }
  return next;
}

/** Expands every collapsed node from the root down to `nodeId`, inclusive, so a new child of it is drawn. */
export function expandPath(graph: ConversationGraph, nodeId: string, now?: number): ConversationGraph {
  let next = graph;
  for (const node of pathToRoot(graph, nodeId)) {
    if (node.collapsed) next = setCollapsed(next, node.id, false, now);
  }
  return next;
}

/** Takes a node and its subtree out, and returns what it took (parents first) so Undo can put it back. */
export function extractBranch(
  graph: ConversationGraph,
  nodeId: string,
): { graph: ConversationGraph; removed: ConversationNode[] } {
  const removed = descendantIds(graph, nodeId).map((id) => graph.nodesById[id]);
  return { graph: removeBranch(graph, nodeId), removed };
}

/** Puts an extracted branch back, every node as it was, in creation order. */
export function restoreBranch(
  graph: ConversationGraph,
  removed: readonly ConversationNode[],
): ConversationGraph {
  if (removed.length === 0) return graph;
  const parentId = removed[0].parentId;
  if (parentId !== null && !graph.nodesById[parentId]) {
    throw new Error(`Cannot restore under ${parentId}: it is gone.`);
  }
  const nodesById: Record<string, ConversationNode> = { ...graph.nodesById };
  for (const node of removed) {
    if (nodesById[node.id]) throw new Error(`Cannot restore ${node.id}: it is already on the canvas.`);
    nodesById[node.id] = node;
  }
  // A stable sort: equal creation times keep their existing order.
  const nodeIds = [...graph.nodeIds, ...removed.map((n) => n.id)].sort(
    (a, b) => nodesById[a].createdAt - nodesById[b].createdAt,
  );
  return { nodesById, nodeIds };
}

/**
 * Retry sends the same prompt again into the same card. Not once the card has
 * replies: they were answered against the text it has, and retrying clears it.
 */
export function canRetry(graph: ConversationGraph, nodeId: string): boolean {
  const node = graph.nodesById[nodeId];
  return !!node && node.status === "error" && childIds(graph, nodeId).length === 0;
}

/** Continue asks for the rest of a stopped reply, in a new card below it. */
export function canContinue(node: ConversationNode): boolean {
  return node.status === "interrupted" && canBranchFrom(node);
}

/** Regenerate asks the same prompt again in a new sibling card. Not while this one is still going. */
export function canRegenerate(graph: ConversationGraph, nodeId: string): boolean {
  const node = graph.nodesById[nodeId];
  if (!node || node.status === "streaming") return false;
  const parent = node.parentId ? graph.nodesById[node.parentId] : null;
  return node.parentId === null || (!!parent && canBranchFrom(parent));
}
```

Create `src/lib/canvas/navigation.ts`:

```ts
import { graphStructure, type ConversationGraph } from './graph';

/** The keyboard's moves between cards (the old app's tree moves, not spatial ones). */
export type FocusMove = 'parent' | 'child' | 'prev' | 'next' | 'first' | 'last';

/**
 * Where a focus move lands, over the cards that are drawn. Arrows walk the tree: up to the parent,
 * down to the first child, left and right between siblings (roots are siblings); none of them wrap.
 * Home is the first root, End the newest leaf. From nothing, or from a card that is gone or hidden,
 * any move starts at the first root (End still finds the newest leaf). Null when there is nowhere to go.
 */
export function moveFocus(graph: ConversationGraph, from: string | null, move: FocusMove): string | null {
	const { children, hidden } = graphStructure(graph);
	const roots = children.get(null) ?? [];
	if (move === 'last') return newestLeaf(graph, children, hidden);
	if (move === 'first') return roots[0] ?? null;
	const node = from ? graph.nodesById[from] : undefined;
	if (!node || hidden.has(node.id)) return roots[0] ?? null;
	if (move === 'parent') return node.parentId;
	if (move === 'child') return node.collapsed ? null : (children.get(node.id)?.[0] ?? null);
	const siblings = children.get(node.parentId) ?? [];
	const next = siblings.indexOf(node.id) + (move === 'next' ? 1 : -1);
	return next >= 0 && next < siblings.length ? siblings[next] : null;
}

/** The drawn card with no drawn children that was created last. A collapsed card counts as a leaf. */
function newestLeaf(
	graph: ConversationGraph,
	children: ReadonlyMap<string | null, readonly string[]>,
	hidden: ReadonlySet<string>
): string | null {
	let best: string | null = null;
	for (const id of graph.nodeIds) {
		if (hidden.has(id)) continue;
		const node = graph.nodesById[id];
		const isLeaf = node.collapsed || (children.get(id)?.length ?? 0) === 0;
		if (isLeaf && (best === null || node.createdAt >= graph.nodesById[best].createdAt)) best = id;
	}
	return best;
}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test`
Expected: PASS. New tests: graph structure 10, navigation 5, viewport 3. Every carried graph test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/graph.ts src/lib/canvas/graph-structure.test.ts src/lib/canvas/navigation.ts src/lib/canvas/navigation.test.ts src/lib/canvas/viewport.test.ts
git commit -m "feat(canvas): structure, branch extract/restore, retry rules and keyboard moves

Pure helpers for Plan 3's canvas features: which cards a collapse hides,
taking a branch out for Undo and putting it back, when Retry, Continue and
Regenerate apply, and tree moves for the arrows, Home and End that skip
hidden cards.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: The shortcut table

One pure function turns a key press into a command, and one constant holds the shortcuts sheet's rows. The rows are a transcription of the old sheet (`shortcuts-sheet.tsx`, 21 rows, flat, in this order). The window handler (Task 10) and the sheet (Task 9) both read from here, so the sheet cannot list a key that does nothing.

**Files:**
- Create: `src/lib/canvas/shortcuts.ts`, `src/lib/canvas/shortcuts.test.ts`

**Interfaces:**
- Consumes: `FocusMove` from Task 4.
- **Produces:**
  - `type Command`, a union over `kind` with these members:
    - `focus` (with `move`), `bind`, `branch`, `regenerate`
    - `toggleCollapsed`, `toggleBody`
    - `resize` (with `dw` and `dh`), `nudge` (with `dx` and `dy`)
    - `delete`, `stop`, `undo`
    - `zoomIn`, `zoomOut`, `fit`, `zoom100`
    - `tidy`, `focusPath`, `transcript`, `shortcuts`
  - `type KeyInput = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>`
  - `type KeyContext = { typing: boolean; onCard: boolean }`
  - `resolveShortcut(e: KeyInput, ctx: KeyContext): Command | null`
  - `SHORTCUT_ROWS: readonly { keys: string; does: string }[]`
  - Constants `NUDGE_PX = 16`, `NUDGE_FAR_PX = 64`, `RESIZE_PX = 8`, `RESIZE_FAR_PX = 32`

- [ ] **Step 1: Write the failing test** — `src/lib/canvas/shortcuts.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './shortcuts'`.

- [ ] **Step 3: Implement** — `src/lib/canvas/shortcuts.ts`

```ts
import type { FocusMove } from './navigation';

/** What a key press asks the canvas to do. */
export type Command =
	| { kind: 'focus'; move: FocusMove }
	| { kind: 'bind' }
	| { kind: 'branch' }
	| { kind: 'regenerate' }
	| { kind: 'toggleCollapsed' }
	| { kind: 'toggleBody' }
	| { kind: 'resize'; dw: number; dh: number }
	| { kind: 'nudge'; dx: number; dy: number }
	| { kind: 'delete' }
	| { kind: 'stop' }
	| { kind: 'undo' }
	| { kind: 'zoomIn' }
	| { kind: 'zoomOut' }
	| { kind: 'fit' }
	| { kind: 'zoom100' }
	| { kind: 'tidy' }
	| { kind: 'focusPath' }
	| { kind: 'transcript' }
	| { kind: 'shortcuts' };

export type KeyInput = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

export type KeyContext = {
	/** Focus is in an input, textarea, select or contenteditable: the keys belong to it. */
	typing: boolean;
	/** The key went to a card itself (an `article[data-node-id]` has DOM focus). */
	onCard: boolean;
};

export const NUDGE_PX = 16;
export const NUDGE_FAR_PX = 64;
export const RESIZE_PX = 8;
export const RESIZE_FAR_PX = 32;

/** The old app's sheet, verbatim and in order (shortcuts-sheet.tsx at c215512). Every row works. */
export const SHORTCUT_ROWS: readonly { keys: string; does: string }[] = [
	{ keys: '↑ / ↓ / ← / →', does: 'Move focus to parent / first child / sibling' },
	{ keys: 'Home / End', does: 'Focus root / most recent leaf' },
	{ keys: 'Enter (node focused)', does: 'Focus the composer, bound to the focused node' },
	{ keys: 'B', does: 'Branch from focused node' },
	{ keys: 'R', does: 'Regenerate focused node' },
	{ keys: 'C', does: "Collapse / expand focused node's subtree" },
	{ keys: 'M', does: "Collapse / expand focused node's own body to one line" },
	{ keys: 'Cmd/Ctrl + Alt + arrows', does: 'Resize focused node' },
	{ keys: 'Delete / Backspace', does: 'Delete focused node + subtree' },
	{ keys: 'Esc', does: 'Stop generation (node focused, streaming)' },
	{ keys: 'Enter (in composer)', does: 'Send (Shift + Enter for a new line)' },
	{ keys: 'Cmd/Ctrl + Z', does: 'Undo last delete' },
	{ keys: '+ / −', does: 'Zoom in / out' },
	{ keys: '0', does: 'Zoom to fit' },
	{ keys: '1', does: 'Zoom to 100%' },
	{ keys: 'Alt + arrows', does: 'Move focused node 16px' },
	{ keys: 'Shift + Alt + arrows', does: 'Move focused node 64px' },
	{ keys: 'L', does: 'Tidy' },
	{ keys: 'F', does: 'Toggle focus-path' },
	{ keys: 'T', does: 'Toggle linear view' },
	{ keys: '?', does: 'This sheet' }
];

const ARROWS: Record<string, readonly [number, number]> = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0]
};
const MOVES: Record<string, FocusMove> = {
	ArrowUp: 'parent',
	ArrowDown: 'child',
	ArrowLeft: 'prev',
	ArrowRight: 'next',
	Home: 'first',
	End: 'last'
};

/**
 * The command a key press means, or null to let the browser have it. Nothing fires while typing.
 * Card commands need the key to have gone to a card. Letters and digits ignore Cmd, Ctrl and Alt,
 * so the browser keeps its own shortcuts (Cmd+R reloads; it never regenerates).
 */
export function resolveShortcut(e: KeyInput, ctx: KeyContext): Command | null {
	if (ctx.typing) return null;
	const mod = e.metaKey || e.ctrlKey;
	const arrow = ARROWS[e.key];
	if (arrow) {
		const [x, y] = arrow;
		if (mod && e.altKey) {
			const step = e.shiftKey ? RESIZE_FAR_PX : RESIZE_PX;
			return ctx.onCard ? { kind: 'resize', dw: x * step, dh: y * step } : null;
		}
		if (e.altKey) {
			const step = e.shiftKey ? NUDGE_FAR_PX : NUDGE_PX;
			return ctx.onCard ? { kind: 'nudge', dx: x * step, dy: y * step } : null;
		}
		if (mod || e.shiftKey) return null;
		return { kind: 'focus', move: MOVES[e.key] };
	}
	if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') return { kind: 'undo' };
	if (mod || e.altKey) return null;
	// No Cmd, Ctrl or Alt from here. Shift only where the key itself needs it (?, +, _).
	switch (e.key) {
		case 'Home':
		case 'End':
			return e.shiftKey ? null : { kind: 'focus', move: MOVES[e.key] };
		case 'Enter':
			return ctx.onCard && !e.shiftKey ? { kind: 'bind' } : null;
		case 'Delete':
		case 'Backspace':
			return ctx.onCard ? { kind: 'delete' } : null;
		case 'Escape':
			return ctx.onCard ? { kind: 'stop' } : null;
		case '?':
			return { kind: 'shortcuts' };
		case '+':
		case '=':
			return { kind: 'zoomIn' };
		case '-':
		case '_':
			return { kind: 'zoomOut' };
		case '0':
			return { kind: 'fit' };
		case '1':
			return { kind: 'zoom100' };
	}
	if (e.shiftKey) return null;
	switch (e.key.toLowerCase()) {
		case 'b':
			return ctx.onCard ? { kind: 'branch' } : null;
		case 'r':
			return ctx.onCard ? { kind: 'regenerate' } : null;
		case 'c':
			return ctx.onCard ? { kind: 'toggleCollapsed' } : null;
		case 'm':
			return ctx.onCard ? { kind: 'toggleBody' } : null;
		case 'l':
			return { kind: 'tidy' };
		case 'f':
			return { kind: 'focusPath' };
		case 't':
			return { kind: 'transcript' };
	}
	return null;
}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test`
Expected: PASS — shortcuts 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/shortcuts.ts src/lib/canvas/shortcuts.test.ts
git commit -m "feat(canvas): the shortcut table — every key on the old sheet, and nothing while typing

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: Saver: deletes, fair retries, the view after its target, one unload save

The saver becomes the only path that tells the server about deletions:
- `markDeleted(id)` queues `DELETE /api/nodes/:id`.
- The flush sends queued deletes after its saves, so a delete never races a save from the same tab.
- An Undo before the flush means the server never hears of the delete. After the flush, the restored nodes are simply saved again.
- The unload save sends the queued deletes with `keepalive`.

Three fixes from the Plan 2 follow-ups land here too:
- **Fair retries.** Nodes the server refused take turns under the 10-singles cap, so one that would now save is not starved.
- **The view waits for its target.** It goes last, and waits while its target node is unsaved; otherwise the server would store "no target".
- **One unload save.** Closing a tab fires `visibilitychange` and then `pagehide`, and they share the browser's 64 KB keepalive budget, so only one unload save runs at a time.

**Files:**
- Modify: `src/lib/canvas/saver.ts` (full replacement below), `src/lib/canvas/saver.test.ts`

**Interfaces:**
- Consumes: Plan 2's `Saver` and its tests.
- **Produces:**
  - `SaverDeps` gains `remove(id: string, keepalive: boolean): Promise<void>`.
  - `Saver` gains `markDeleted(id): void` and `cancelDeletion(id): void`.
  - `pending` now also counts queued deletes.
  - Every Plan 2 behaviour is kept.

- [ ] **Step 1: Update the test harness and write the failing tests**

In `src/lib/canvas/saver.test.ts`'s `harness()`:
- Make the view mutable: `let view: ViewWire = { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null };`, with `getView: () => view` unchanged.
- Add a removal log and a failure switch: `const removals: { id: string; keepalive: boolean }[] = []; let removeFails: unknown = null;`.
- Add the `remove` dependency:

```ts
		remove: async (id, keepalive) => {
			if (removeFails) {
				const e = removeFails;
				removeFails = null;
				throw e;
			}
			removals.push({ id, keepalive });
		},
```

- Return three more members: `removals`, `failRemove: (e: unknown) => (removeFails = e)` and `setTarget: (id: string | null) => (view = { ...view, targetNodeId: id })`.
- The two default-clock tests build their dependencies inline, so add `remove: async () => {},` to each.

Then append, inside `describe('Saver')`:

```ts
	it('sends a pending delete after the flush saves, and never saves a node deleted before its first save', async () => {
		const nodes: Record<string, NodeWire> = { keep: node('keep'), gone: node('gone') };
		const h = harness(nodes);
		h.saver.markNode('keep');
		h.saver.markNode('gone');
		delete nodes.gone;
		h.saver.markDeleted('gone');
		await h.saver.flush();
		assert.deepEqual(h.sent.map((s) => s.body.upserts.map((n) => n.id)), [['keep']]);
		assert.deepEqual(h.removals, [{ id: 'gone', keepalive: false }]);
		assert.equal(h.saver.pending, 0);
	});

	it('Undo before the flush means the server never hears of the delete', async () => {
		const h = harness({ a: node('a') });
		h.saver.markDeleted('a');
		h.saver.cancelDeletion('a');
		h.saver.markNode('a');
		await h.saver.flush();
		assert.deepEqual(h.removals, []);
		assert.deepEqual(h.sent.map((s) => s.body.upserts.map((n) => n.id)), [['a']]);
	});

	it('keeps a delete pending through a network failure, and sends it on the next flush', async () => {
		const h = harness({});
		h.saver.markDeleted('x');
		h.failRemove({ code: 'network' });
		await h.saver.flush();
		assert.deepEqual(h.removals, []);
		assert.deepEqual(h.errors, [null], 'a network failure raises no banner');
		assert.equal(h.saver.pending, 1);
		await h.saver.flush();
		assert.deepEqual(h.removals, [{ id: 'x', keepalive: false }]);
		assert.equal(h.saver.pending, 0);
	});

	it('raises the banner when the server refuses a delete, and keeps it pending', async () => {
		const h = harness({});
		h.saver.markDeleted('x');
		h.failRemove({ code: 'internal_error' });
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved']);
		assert.equal(h.saver.pending, 1);
	});

	it('the unload save also sends pending deletes, with keepalive, and keeps them pending', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.saver.markDeleted('gone');
		await h.saver.flush({ keepalive: true });
		assert.deepEqual(h.removals, [{ id: 'gone', keepalive: true }]);
		assert.ok(h.sent.some((s) => s.keepalive && s.body.upserts.some((n) => n.id === 'a')));
		assert.equal(h.saver.pending, 2, 'the regular flush still owns them');
	});

	it('a second unload save while one is in flight sends nothing more', async () => {
		const puts: boolean[] = [];
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		const saver = new Saver({
			getNode: (id) => (id === 'a' ? node('a') : null),
			depthOf: () => 0,
			getView: () => ({ viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null }),
			put: async (_body, keepalive) => {
				puts.push(keepalive);
				await held;
				return { rejected: [] };
			},
			remove: async () => {},
			isOnline: () => true,
			onError: () => {},
			priority: () => [],
			failureMessage: 'not saved'
		});
		saver.markNode('a');
		const first = saver.flush({ keepalive: true });
		const second = saver.flush({ keepalive: true });
		release();
		await Promise.all([first, second]);
		assert.deepEqual(puts, [true]);
	});

	it('nodes sent alone take turns under the cap, so a node the server now accepts is not starved', async () => {
		const nodes: Record<string, NodeWire> = {};
		for (let i = 1; i <= 10; i++) nodes[`bad${i}`] = node(`bad${i}`, { createdAt: i });
		nodes.late = node('late', { createdAt: 11 });
		const h = harness(nodes);
		for (const id of Object.keys(nodes)) {
			h.refuse(id);
			h.saver.markNode(id);
		}
		await h.saver.flush(); // the batch is refused; bad1–bad10 go alone and are refused; late waits (cap)
		await h.saver.flush(); // late is refused on its own; bad1–bad10 are refused again
		h.allow('late');
		await h.saver.flush(); // late was tried least recently, so it goes first
		assert.ok(h.sent.some((s) => s.body.upserts.length === 1 && s.body.upserts[0].id === 'late'), 'late was saved');
	});

	it('holds the view back while its target node is not saved, then sends it', async () => {
		const h = harness({ t: node('t') });
		h.refuse('t');
		h.saver.markNode('t');
		h.setTarget('t');
		h.saver.markView();
		await h.saver.flush();
		await h.saver.flush();
		assert.equal(h.sent.some((s) => s.body.view), false, 'a view naming an unsaved node would store no target');
		h.allow('t');
		await h.saver.flush();
		assert.ok(h.sent.some((s) => s.body.view?.targetNodeId === 't'));
	});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL. `markDeleted`, `cancelDeletion` and the `remove` dependency do not exist yet. The rotation and view tests also fail against the old ordering.

- [ ] **Step 3: Implement** — replace `src/lib/canvas/saver.ts` with:

```ts
import type { NodeWire, ViewWire } from './node-wire';

export type SaveBody = { upserts: NodeWire[]; view?: ViewWire };

export type SaverDeps = {
	getNode(id: string): NodeWire | null;
	depthOf(id: string): number;
	getView(): ViewWire;
	put(body: SaveBody, keepalive: boolean): Promise<{ rejected: string[] }>;
	/** `DELETE /api/nodes/:id` — the server removes the node and everything below it. */
	remove(id: string, keepalive: boolean): Promise<void>;
	isOnline(): boolean;
	/** The banner: a message while saves fail for a non-network reason, null once they succeed. */
	onError(message: string | null): void;
	/** Ids to send first in a keepalive (the streaming nodes). */
	priority(): string[];
	failureMessage: string;
};

export const SAVE_INTERVAL_MS = 1500;
export const MAX_BATCH_NODES = 200;
export const MAX_BATCH_BYTES = 4 * 1024 * 1024 - 64 * 1024;
export const KEEPALIVE_BYTES = 60 * 1024;
/** A backstop on single-node retries per flush; the rest stay dirty for the next one. */
export const MAX_SINGLES_PER_FLUSH = 10;

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

/**
 * How one request went. Only `invalid_request` and `payload_too_large` are about the nodes' content,
 * so only they isolate the request's nodes (`refused`). Anything else — signed out, CSRF, a rate limit,
 * a database outage, an unexpected throw — would fail every request alike, so it stops the flush.
 */
type Attempt = 'saved' | 'refused' | 'network' | 'stopped';
const classify = (error: unknown): Attempt => {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === 'network') return 'network';
	return code === 'invalid_request' || code === 'payload_too_large' ? 'refused' : 'stopped';
};

/** Remembers which nodes changed, and which branches were deleted, and tells the server — parents first. */
export class Saver {
	private dirty = new Set<string>();
	private viewDirty = false;
	private inFlight: Promise<void> | null = null;
	private inFlightIds = new Set<string>();
	private inFlightView = false;
	/** Nodes the server refused when sent alone: sent one per request until it takes them. */
	private suspects = new Set<string>();
	/** When each node was last sent alone (a counter): the least recent goes first, so none starves under the cap. */
	private suspectTried = new Map<string, number>();
	private tries = 0;
	/** Roots of deleted branches the server has not been told about yet. */
	private deletions = new Set<string>();
	private keepaliveInFlight: Promise<void> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private deps: SaverDeps,
		private readonly clock = {
			setInterval: ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms)) as typeof setInterval,
			clearInterval: ((id: ReturnType<typeof setInterval>) => globalThis.clearInterval(id)) as typeof clearInterval
		}
	) {}

	markNode(id: string): void {
		this.dirty.add(id);
	}

	markView(): void {
		this.viewDirty = true;
	}

	/** Queues `DELETE /api/nodes/:id`. It goes after the next flush's saves, so it never races one. */
	markDeleted(id: string): void {
		this.deletions.add(id);
	}

	/** Undo before the delete went out: the server never hears of it. (After, the restored nodes are saved again.) */
	cancelDeletion(id: string): void {
		this.deletions.delete(id);
	}

	get pending(): number {
		const ids = new Set([...this.dirty, ...this.inFlightIds]);
		return ids.size + (this.viewDirty || this.inFlightView ? 1 : 0) + this.deletions.size;
	}

	start(): void {
		this.timer ??= this.clock.setInterval(() => void this.flush(), SAVE_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer !== null) this.clock.clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * The requests a flush would send now: parents first, in batches; then any node the server refused
	 * before, alone, least recently tried first; then the view — with the last batch when nothing goes
	 * alone, otherwise on its own after them, so it never names a node the server does not have yet.
	 * Vanished nodes are dropped.
	 */
	batches(): SaveBody[] {
		const nodes: NodeWire[] = [];
		for (const id of this.dirty) {
			const n = this.deps.getNode(id);
			if (n) nodes.push(n);
			else this.forget(id);
		}
		const order = (a: NodeWire, b: NodeWire) => this.deps.depthOf(a.id) - this.deps.depthOf(b.id) || a.createdAt - b.createdAt;
		nodes.sort(order);
		const suspects = nodes
			.filter((n) => this.suspects.has(n.id))
			.sort((a, b) => (this.suspectTried.get(a.id) ?? 0) - (this.suspectTried.get(b.id) ?? 0) || order(a, b));
		const out: SaveBody[] = [];
		let current: SaveBody = { upserts: [] };
		let size = bytes(current);
		for (const n of nodes) {
			if (this.suspects.has(n.id)) continue;
			const s = bytes(n) + 1;
			if (current.upserts.length > 0 && (current.upserts.length >= MAX_BATCH_NODES || size + s > MAX_BATCH_BYTES)) {
				out.push(current);
				current = { upserts: [] };
				size = bytes(current);
			}
			current.upserts.push(n);
			size += s;
		}
		const view = this.viewDirty ? this.deps.getView() : null;
		if (view && suspects.length === 0) current.view = view;
		if (current.upserts.length > 0 || current.view) out.push(current);
		for (const n of suspects) out.push({ upserts: [n] });
		if (view && suspects.length > 0) out.push({ upserts: [], view });
		return out;
	}

	flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
		if (keepalive) return this.flushKeepalive();
		if (this.inFlight) return this.inFlight;
		if (!this.deps.isOnline() || this.pending === 0) return Promise.resolve();
		this.inFlight = this.run().finally(() => (this.inFlight = null));
		return this.inFlight;
	}

	private forget(id: string): void {
		this.dirty.delete(id);
		this.suspects.delete(id);
		this.suspectTried.delete(id);
	}

	private async run(): Promise<void> {
		try {
			const queue = this.batches();
			// Move to in-flight before clearing dirty
			for (const b of queue) b.upserts.forEach((n) => this.inFlightIds.add(n.id));
			if (queue.some((b) => b.view)) this.inFlightView = true;
			this.dirty.clear();
			this.viewDirty = false;

			// Single-node requests: a refused batch split up, and nodes refused on an earlier flush.
			const singles = new Set(queue.filter((b) => b.upserts.length === 1 && !b.view && this.suspects.has(b.upserts[0].id)));
			const unsaved = new Set<string>(); // nodes this flush could not save
			let sentSingles = 0;
			let failed = false; // something the server refused or could not take: the banner goes up
			let halted = false; // the server, or the network, cannot take anything right now
			while (queue.length > 0) {
				const body = queue.shift()!;
				if (singles.has(body) && sentSingles >= MAX_SINGLES_PER_FLUSH) {
					this.requeue([body]);
					unsaved.add(body.upserts[0].id);
					failed = true;
					continue;
				}
				// The view names its target; sent before that node is saved, the server would store none.
				const target = body.view?.targetNodeId;
				if (body.upserts.length === 0 && target && unsaved.has(target)) {
					this.requeue([body]);
					continue;
				}
				if (singles.has(body)) {
					sentSingles += 1;
					this.suspectTried.set(body.upserts[0].id, ++this.tries);
				}
				const result = await this.attempt(body);
				if (result === 'saved') continue;
				if (result === 'refused' && body.upserts.length + (body.view ? 1 : 0) > 1) {
					// Find the node(s) the server will not take: one per request, still parents first, then the view.
					const split = body.upserts.map((n) => ({ upserts: [n] }));
					split.forEach((b) => singles.add(b));
					queue.unshift(...split, ...(body.view ? [{ upserts: [], view: body.view }] : []));
					continue;
				}
				// Not confirmed goes back to dirty; changes made meanwhile are already there.
				this.requeue([body]);
				body.upserts.forEach((n) => unsaved.add(n.id));
				if (result === 'refused') {
					body.upserts.forEach((n) => this.suspects.add(n.id));
					failed = true;
					continue;
				}
				// Offline, signed out, rate limited, the server down: sending more now only fails the same way.
				this.requeue(queue);
				if (result === 'network' && !failed) return;
				failed = true;
				halted = true;
				break;
			}
			if (!halted && (await this.sendDeletions()) === 'failed') failed = true;
			this.deps.onError(failed ? this.deps.failureMessage : null);
		} catch {
			// Unexpected error in deps (e.g., getView throws)
			// Put all batched ids back to dirty
			for (const id of this.inFlightIds) this.dirty.add(id);
			if (this.inFlightView) this.viewDirty = true;
			this.inFlightIds.clear();
			this.inFlightView = false;
			try {
				this.deps.onError(this.deps.failureMessage);
			} catch {
				// Ignore errors from onError itself
			}
		}
	}

	/** After the saves: one DELETE per deleted branch. A network failure leaves the rest for next time. */
	private async sendDeletions(): Promise<'ok' | 'failed' | 'offline'> {
		for (const id of [...this.deletions]) {
			if (!this.deletions.has(id)) continue; // undone meanwhile
			try {
				await this.deps.remove(id, false);
				this.deletions.delete(id);
			} catch (error) {
				return classify(error) === 'network' ? 'offline' : 'failed';
			}
		}
		return 'ok';
	}

	private async attempt(body: SaveBody): Promise<Attempt> {
		try {
			await this.deps.put(body, false);
		} catch (error) {
			return classify(error);
		}
		body.upserts.forEach((n) => {
			this.inFlightIds.delete(n.id);
			this.suspects.delete(n.id);
			this.suspectTried.delete(n.id);
		});
		if (body.view) this.inFlightView = false;
		return 'saved';
	}

	private requeue(bodies: SaveBody[]): void {
		for (const b of bodies) {
			b.upserts.forEach((n) => {
				this.dirty.add(n.id);
				this.inFlightIds.delete(n.id);
			});
			if (b.view) {
				this.viewDirty = true;
				this.inFlightView = false;
			}
		}
	}

	/**
	 * Unload path: one request under the browser's keepalive cap; nothing is cleared. A tab closing fires
	 * visibilitychange → hidden and then pagehide, and the two share the browser's 64 KB keepalive
	 * budget, so while one unload save is in flight a second sends nothing more.
	 */
	private flushKeepalive(): Promise<void> {
		this.keepaliveInFlight ??= this.flushKeepaliveImpl()
			.catch(() => {
				// Never reject on the unload path; swallow errors from getNode/getView
			})
			.finally(() => (this.keepaliveInFlight = null));
		return this.keepaliveInFlight;
	}

	private async flushKeepaliveImpl(): Promise<void> {
		// Deletes carry no body, so they cost the keepalive budget nothing: send them first.
		for (const id of this.deletions) void this.deps.remove(id, true).catch(() => {});

		// Candidates = dirty ∪ inFlight
		const candidates = new Set([...this.dirty, ...this.inFlightIds]);
		const first = this.deps.priority().filter((id) => candidates.has(id));
		const rest = [...candidates].filter((id) => !first.includes(id));

		const body: SaveBody = { upserts: [], ...(this.viewDirty || this.inFlightView ? { view: this.deps.getView() } : {}) };
		let size = bytes(body);
		const included = new Set<string>();
		// A node the server refused would sink the whole unload save, and its descendants with it.
		const skipped = new Set([...this.suspects].filter((id) => candidates.has(id)));

		// Walk candidates in priority order, then rest
		const walk = (id: string): string[] => {
			const chain: string[] = [];
			let current: string | null = id;
			while (current !== null) {
				if (included.has(current)) break;
				// If ancestor is skipped (or a candidate not yet included), can't use this candidate
				if (skipped.has(current)) return [];
				if (!candidates.has(current)) break;
				const n = this.deps.getNode(current);
				if (!n) break;
				chain.unshift(current);
				current = n.parentId;
			}
			return chain;
		};

		for (const id of [...first, ...rest]) {
			if (included.has(id) || skipped.has(id)) continue;
			const chain = walk(id);
			if (chain.length === 0) continue;

			// Check if entire chain fits
			let chainSize = 0;
			const nodes: NodeWire[] = [];
			for (const cid of chain) {
				const n = this.deps.getNode(cid);
				if (!n) continue;
				chainSize += bytes(n) + 1;
				nodes.push(n);
			}

			if (size + chainSize > KEEPALIVE_BYTES) {
				// Mark entire chain as skipped
				for (const cid of chain) skipped.add(cid);
				continue;
			}

			// Add entire chain
			for (const n of nodes) {
				body.upserts.push(n);
				included.add(n.id);
			}
			size += chainSize;
		}

		// Sort by depth
		body.upserts.sort((a, b) => this.deps.depthOf(a.id) - this.deps.depthOf(b.id) || a.createdAt - b.createdAt);

		if (body.upserts.length === 0 && !body.view) return;
		await this.deps.put(body, true);
	}
}
```

Compared with Plan 2's saver:
- **New:** the delete queue, the suspect rotation, the "view waits for its target" rule and the single unload save.
- **Moved:** the error swallowing for the unload path now lives in `flushKeepalive`.
- **Unchanged:** everything else. Only comments were tidied.

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test`
Expected: PASS. All of Plan 2's saver tests pass unchanged, apart from the added `remove` dependency in the two inline harnesses. There are 8 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/saver.ts src/lib/canvas/saver.test.ts
git commit -m "feat(canvas): the saver sends deletes after its saves, and retries refused nodes fairly

A delete is queued and sent after the flush's saves, so it never races one
from the same tab; Undo before the flush means the server never hears of it,
and the unload save sends queued deletes with keepalive. Nodes the server
refused take turns under the singles cap, the view waits for its target to
be saved, and only one unload save runs at a time.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---
### Task 7: Card actions — Retry, Continue, Regenerate, Delete and Undo

Spec §4 covers retry and continue on an error or interruption, and deleting a card and its subtree with an Undo toast. The old app also had Regenerate (`R`, and a button on stopped cards). This task adds the store actions and the card's buttons.

**Retry.** Re-sends the same prompt into the same card. It applies to a failed card with no replies, because the replies were answered against the text that Retry would clear.

**Continue.** Asks for the rest of a stopped reply, in a new card below it. The new card's request ends with the user message `CONTINUE_PROMPT`, and the card shows "continued from above".

**Regenerate.** Asks the same prompt again, in a sibling card. It applies to a stopped card, or to a failed card that cannot be retried.

**Delete.**
- No confirmation; the toast offers Undo for 8 s, one level deep.
- Streams in the removed branch stop.
- If the composer target was in the branch, the composer goes back to "New conversation".
- The saver queues `DELETE /api/nodes/:id` (Task 6).

**Undo.**
- Puts the branch back with every position, size and flag.
- A card that was mid-reply comes back "Stopped".
- The composer target comes back too, if nothing else has taken its place.

Continue and Regenerate move the composer to the new card. They count as sending in the target invariant. `Cmd/Ctrl+Z` and the keyboard Delete arrive in Task 10; this task's tests use the buttons.

**Files:**
- Modify: `src/lib/canvas/store.svelte.ts` (full replacement below)
- Modify: `src/lib/components/canvas/NodeCard.svelte` (full replacement below), `src/lib/components/canvas/Canvas.svelte`
- Create: `src/lib/components/canvas/UndoToast.svelte`
- Modify: `src/lib/canvas/copy.ts`
- Create: `tests/e2e/cards.spec.ts`

**Interfaces:**
- **Consumes:**
  - Task 4: `canRetry`, `canContinue`, `canRegenerate`, `CONTINUE_PROMPT`, `extractBranch`, `restoreBranch`.
  - Task 6: `Saver.markDeleted`, `Saver.cancelDeletion`, and `SaverDeps.remove`.
  - Plan 2's store: `commit`, `enqueue`, `settle`, `measure`.
  - `nodeWidthsFrom` from `layout.ts`.
- **Produces (store):**
  - `UNDO_MS = 8000`.
  - `type UndoState = { rootId: string; removed: ConversationNode[]; clearedTarget: string | null }`.
  - Field `undo: UndoState | null`.
  - Getter `streamBlockedReason: string | null`, meaning offline or out of messages, whatever the target.
  - Methods `retry(id)`, `continueReply(id)`, `regenerate(id)`, `remove(id)`, `undoRemove()`.
  - Private `createAndStream(parentId, prompt): string`, used by `send`, `continueReply` and `regenerate`.
- **Produces (other):**
  - Copy key `node.action.delete`.
  - DOM: every card has `button[aria-label="Delete"]`.
  - Footer buttons named "Retry", "Continue" and "Regenerate".
  - The toast is `role="status"` with an "Undo" button.

- [ ] **Step 1: Write the failing browser tests** — `tests/e2e/cards.spec.ts`

```ts
import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';
import { cards, savedNodesText, send } from './helpers';

test('deleting an ancestor of the target clears the composer, and Undo rebinds it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'parent card');
	const b = await send(page, 'child card');
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect(cards(page)).toHaveCount(0);
	await expect(page.getByRole('status').filter({ hasText: 'Node and 1 below it deleted.' })).toBeVisible();
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', '');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator(`article[data-node-id="${a}"]`)).toBeVisible();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toBeVisible();
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', b);
});

test('a delete survives a reload, and so does its undo', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'delete me for good');
	await expect.poll(() => savedNodesText(page)).toContain('delete me for good');
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect.poll(() => savedNodesText(page)).not.toContain('delete me for good');
	await page.reload();
	await expect(page.getByText('Ask anything. Then take it three directions.')).toBeVisible();

	const b = await send(page, 'bring me back');
	await expect.poll(() => savedNodesText(page)).toContain('bring me back');
	await page.locator(`article[data-node-id="${b}"]`).getByRole('button', { name: 'Delete' }).click();
	await expect.poll(() => savedNodesText(page)).not.toContain('bring me back');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => savedNodesText(page)).toContain('bring me back');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toContainText('Echo: bring me back.');
});

test('deleting a streaming branch stops it, and Undo brings it back as Stopped', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] keep going', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: keep going.');
	await card.getByRole('button', { name: 'Delete' }).click();
	await expect(card).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(card).toHaveAttribute('data-status', 'interrupted');
	await expect(card).toContainText('Echo: keep going.');
	const body = card.getByTestId('card-body');
	const text = await body.innerText();
	await page.waitForTimeout(800); // a stream left running would keep adding text
	expect(await body.innerText()).toBe(text);
	await expect.poll(() => savedNodesText(page)).toContain('"interrupted"');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'interrupted');
});

test('Retry sends the same prompt again into the same card', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[refuse] try again', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await resetAnthropic();
	await card.getByRole('button', { name: 'Retry' }).click();
	await expect.poll(async () => (await anthropicRequests()).length).toBe(1);
	await expect(card).toHaveAttribute('data-status', 'error'); // the fake refuses every time
	const [sent] = await anthropicRequests();
	expect((sent.body.messages as { content: string }[]).at(-1)?.content).toBe('[refuse] try again');
	await expect(cards(page)).toHaveCount(1);
});

test('Continue asks for the rest of a stopped reply in a new card below it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] continue me', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: continue me.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await expect(card).toHaveAttribute('data-status', 'interrupted');
	await resetAnthropic();
	await card.getByRole('button', { name: 'Continue' }).click();
	const target = page.getByTestId('composer-target');
	await expect(target).not.toHaveAttribute('data-target-id', id);
	const child = page.locator(`article[data-node-id="${await target.getAttribute('data-target-id')}"]`);
	await expect(child).toHaveAttribute('data-parent-id', id);
	await expect(child).toContainText('continued from above');
	await expect.poll(async () => (await anthropicRequests()).length).toBe(1);
	const messages = (await anthropicRequests())[0].body.messages as { role: string; content: string }[];
	expect(messages.at(-1)).toEqual({ role: 'user', content: 'Continue from where you left off.' });
	expect(messages.at(-2)?.role).toBe('assistant');
	expect(messages.at(-2)?.content).toMatch(/^Echo: continue me\./);
});

test('Regenerate asks the same prompt again in a new card beside it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const root = await send(page, 'root for regenerate');
	const id = await send(page, '[slow][long] say it again', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: say it again.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await card.getByRole('button', { name: 'Regenerate' }).click();
	const target = page.getByTestId('composer-target');
	await expect(target).not.toHaveAttribute('data-target-id', id);
	const sibling = page.locator(`article[data-node-id="${await target.getAttribute('data-target-id')}"]`);
	await expect(sibling).toHaveAttribute('data-parent-id', root);
	await expect(sibling.locator('.prompt')).toHaveText('[slow][long] say it again');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:e2e`
Expected: FAIL — no Delete, Retry, Continue or Regenerate buttons.

- [ ] **Step 3: The store** — replace `src/lib/canvas/store.svelte.ts` with:

```ts
import { getContext, setContext } from 'svelte';
import { ApiCallError, apiFetch, type RateLimitSnapshot } from './api-client';
import { copy } from './copy';
import { TIMEOUT_ERROR, toNodeError } from './errors';
import {
	addNode,
	appendText,
	appendThinking,
	canBranchFrom,
	canContinue,
	canRegenerate,
	canRetry,
	checkBranchSize,
	completeNode,
	CONTINUE_PROMPT,
	extractBranch,
	failNode,
	interruptNode,
	moveNode,
	pathToRoot,
	restoreBranch,
	settleOrphanedStreams,
	startStreaming,
	toMessages,
	type ConversationGraph,
	type ConversationNode
} from './graph';
import {
	autoPlaceOnCreate,
	centeredRootPosition,
	NODE_WIDTH_DESKTOP,
	nodeWidthsFrom,
	reflowChildrenOnCreate,
	tidyLayout,
	type NodeHeights
} from './layout';
import { fromWire, toWire, type NodeWire, type ViewWire } from './node-wire';
import { Saver, type SaveBody } from './saver';
import { streamChat } from './stream';
import { StreamQueue, type Outcome } from './streams';
import type { Viewport } from './viewport';
import { MAX_MESSAGE_CHARS } from '../shared/chat-limits';
import type { ChatStreamEvent } from '../shared/chat-types';

type Point = { x: number; y: number };
export type CanvasInit = { nodes: NodeWire[]; view: ViewWire | null; model: string };

/** How long a delete can be undone (the old app's DELETE_UNDO_MS). One level only. */
export const UNDO_MS = 8000;

/** The last delete, for Undo. */
export type UndoState = {
	rootId: string;
	/** The removed nodes, parents first. Any that were mid-reply come back stopped, never spinning. */
	removed: ConversationNode[];
	/** The composer target the delete cleared, or null when the target was not in the branch. */
	clearedTarget: string | null;
};

export class CanvasStore {
	graph = $state.raw<ConversationGraph>({ nodesById: {}, nodeIds: [] });
	/**
	 * Changed only by Branch, send (Continue and Regenerate send too), New conversation, Enter on a
	 * focused card (Task 10), and deleting the target or an ancestor of it (then null; Undo puts it back).
	 */
	target = $state<string | null>(null);
	following = $state<string | null>(null);
	layoutVersion = $state(0);
	queueVersion = $state(0);
	model = $state('');
	rateLimit = $state<RateLimitSnapshot | null>(null);
	saveError = $state<string | null>(null);
	online = $state(true);
	undo = $state.raw<UndoState | null>(null);

	readonly width = NODE_WIDTH_DESKTOP;
	viewport: Viewport;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-off snapshot, never observed
	measure: () => NodeHeights = () => new Map();
	visibleCenter: () => Point = () => ({ x: 0, y: 0 });

	private readonly streams: StreamQueue;
	private readonly saver: Saver;
	private readonly cleanups: (() => void)[] = [];
	private rateLimitReset: ReturnType<typeof setTimeout> | null = null;
	private undoTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(init: CanvasInit) {
		const loaded = fromWire(init.nodes);
		const settled = settleOrphanedStreams(loaded);
		this.graph = settled;
		this.model = init.model;
		this.viewport = init.view?.viewport ?? { x: 0, y: 0, zoom: 1 };
		const t = init.view?.targetNodeId;
		this.target = t && settled.nodesById[t] ? t : null;
		this.streams = new StreamQueue((id, outcome) => this.settle(id, outcome), () => this.queueVersion++);
		this.saver = new Saver({
			getNode: (id) => (this.graph.nodesById[id] ? toWire(this.graph.nodesById[id]) : null),
			depthOf: (id) => (this.graph.nodesById[id] ? pathToRoot(this.graph, id).length : 0),
			getView: () => ({ viewport: this.viewport, targetNodeId: this.target }),
			put: (body: SaveBody, keepalive: boolean) => apiFetch<{ rejected: string[] }>('/api/nodes', { method: 'PUT', body, keepalive }),
			remove: (id: string, keepalive: boolean) => apiFetch<void>(`/api/nodes/${id}`, { method: 'DELETE', keepalive }),
			isOnline: () => this.online,
			onError: (message) => (this.saveError = message),
			priority: () => this.graph.nodeIds.filter((id) => this.graph.nodesById[id].status === 'streaming'),
			failureMessage: copy('save.failed.banner')
		});
		// Streams orphaned by a reload settle to "interrupted" — save that back.
		for (const id of settled.nodeIds) if (settled.nodesById[id] !== loaded.nodesById[id]) this.saver.markNode(id);
	}

	start(): void {
		this.online = navigator.onLine;
		const online = () => {
			this.online = true;
			void this.saver.flush();
		};
		const offline = () => (this.online = false);
		const hidden = () => {
			if (document.visibilityState === 'hidden') void this.saver.flush({ keepalive: true });
		};
		const pagehide = () => void this.saver.flush({ keepalive: true });
		addEventListener('online', online);
		addEventListener('offline', offline);
		document.addEventListener('visibilitychange', hidden);
		addEventListener('pagehide', pagehide);
		this.cleanups.push(
			() => removeEventListener('online', online),
			() => removeEventListener('offline', offline),
			() => document.removeEventListener('visibilitychange', hidden),
			() => removeEventListener('pagehide', pagehide)
		);
		this.saver.start();
	}

	dispose(): void {
		this.streams.stopAll();
		// An in-app link leaves without pagehide or visibilitychange, and the page's JS lives on, so a
		// normal flush (no keepalive cap) saves what changed since the last tick.
		void this.saver.flush();
		this.cleanups.forEach((f) => f());
		this.saver.stop();
		if (this.rateLimitReset !== null) clearTimeout(this.rateLimitReset);
		this.rateLimitReset = null;
		if (this.undoTimer !== null) clearTimeout(this.undoTimer);
		this.undoTimer = null;
	}

	/** Replace the graph and mark every node object that changed. */
	private commit(next: ConversationGraph): void {
		const prev = this.graph;
		this.graph = next;
		for (const id of next.nodeIds) if (next.nodesById[id] !== prev.nodesById[id]) this.saver.markNode(id);
	}

	label(id: string | null): string {
		if (!id) return copy('composer.newConversation');
		const prompt = this.graph.nodesById[id]?.prompt ?? '';
		return prompt.length > 32 ? `“${prompt.slice(0, 31)}…”` : `“${prompt}”`;
	}

	get limitReached(): boolean {
		return this.rateLimit !== null && this.rateLimit.remaining === 0;
	}

	/** Why nothing can be sent right now, whatever the target: offline, or out of messages. */
	get streamBlockedReason(): string | null {
		if (!this.online) return copy('composer.placeholder.offline');
		if (this.limitReached) return copy('composer.placeholder.rateLimited');
		return null;
	}

	get sendBlockedReason(): string | null {
		const blocked = this.streamBlockedReason;
		if (blocked) return blocked;
		const t = this.target ? this.graph.nodesById[this.target] : null;
		if (t && !canBranchFrom(t)) return copy(t.status === 'error' || t.status === 'interrupted' ? 'branch.failed' : 'branch.disabled');
		return null;
	}

	queuePosition(id: string): number | null {
		void this.queueVersion;
		return this.streams.position(id);
	}

	branch(id: string): void {
		this.target = id;
		this.saver.markView();
	}

	newConversation(): void {
		this.target = null;
		this.saver.markView();
	}

	setModel(id: string): void {
		this.model = id;
		try {
			localStorage.setItem('nc:model', id);
		} catch {
			// private mode or blocked storage: the choice just won't persist
		}
	}

	setViewport(viewport: Viewport): void {
		this.viewport = viewport;
		this.saver.markView();
	}

	/** False when nothing was sent: the composer keeps the draft. */
	send(prompt: string): boolean {
		const text = prompt.trim();
		// Over the cap the server refuses to save the node, so none is created; the composer says why.
		if (!text || text.length > MAX_MESSAGE_CHARS || this.sendBlockedReason) return false;
		this.createAndStream(this.target, text);
		return true;
	}

	/** Continue: the rest of a stopped reply, asked for in a new card below it. */
	continueReply(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node || !canContinue(node) || this.streamBlockedReason) return;
		this.createAndStream(id, CONTINUE_PROMPT);
	}

	/** Regenerate: the same prompt again, in a new card beside this one. */
	regenerate(id: string): void {
		if (!canRegenerate(this.graph, id) || this.streamBlockedReason) return;
		const node = this.graph.nodesById[id];
		this.createAndStream(node.parentId, node.prompt);
	}

	/** Retry: the same prompt again, into the same card, replacing the failed reply. */
	retry(id: string): void {
		if (!canRetry(this.graph, id) || this.streamBlockedReason) return;
		const tooLong = checkBranchSize(toMessages(this.graph, id));
		if (tooLong) {
			this.commit(failNode(this.graph, id, { code: 'invalid_request', message: tooLong.message }));
			return;
		}
		this.commit(startStreaming(this.graph, id));
		this.following = id;
		this.enqueue(id);
	}

	/** A new card under `parentId` (a new root when null) asking `prompt`, streamed; the composer moves to it. */
	private createAndStream(parentId: string | null, prompt: string): string {
		let graph = this.graph;
		const heights = this.measure();
		const widths = nodeWidthsFrom(graph, this.width);
		const position = parentId
			? autoPlaceOnCreate(graph, parentId, this.width, heights, widths)
			: graph.nodeIds.length === 0
				? centeredRootPosition(this.visibleCenter(), this.width)
				: autoPlaceOnCreate(graph, null, this.width, heights, widths);
		const added = addNode(graph, { parentId, prompt, position, model: this.model });
		graph = parentId ? reflowChildrenOnCreate(added.graph, parentId, this.width, heights, widths) : added.graph;
		const id = added.node.id;
		const tooLong = checkBranchSize(toMessages(graph, id));
		graph = tooLong ? failNode(graph, id, { code: 'invalid_request', message: tooLong.message }) : startStreaming(graph, id);
		this.commit(graph);
		this.target = id;
		this.following = id;
		this.layoutVersion++;
		this.saver.markView();
		if (!tooLong) this.enqueue(id);
		return id;
	}

	private enqueue(id: string): void {
		const model = this.graph.nodesById[id].model ?? this.model;
		this.streams.enqueue(id, ({ signal, activity }) =>
			streamChat({
				model,
				messages: toMessages(this.graph, id),
				signal,
				onEvent: (event) => {
					activity();
					this.apply(id, event);
				},
				onRateLimit: (snapshot) => this.noteRateLimit(snapshot)
			})
		);
	}

	private noteRateLimit(snapshot: RateLimitSnapshot): void {
		this.rateLimit = snapshot;
		if (this.rateLimitReset !== null) clearTimeout(this.rateLimitReset);
		this.rateLimitReset = null;
		if (snapshot.remaining === 0) {
			this.rateLimitReset = setTimeout(() => {
				this.rateLimitReset = null;
				if (this.rateLimit === snapshot) this.rateLimit = { ...snapshot, remaining: snapshot.limit };
			}, snapshot.resetSeconds * 1000);
		}
	}

	private apply(id: string, event: ChatStreamEvent): void {
		if (event.type === 'ping') return; // the model started; onEvent already called activity()
		if (!this.graph.nodesById[id]) return;
		if (event.type === 'text') this.commit(appendText(this.graph, id, event.text));
		else if (event.type === 'thinking') this.commit(appendThinking(this.graph, id, event.text));
		else if (event.type === 'done') this.commit(completeNode(this.graph, id, event.usage));
		else this.commit(failNode(this.graph, id, { code: event.code, message: event.message }));
	}

	private settle(id: string, outcome: Outcome): void {
		const node = this.graph.nodesById[id];
		if (!node || node.status !== 'streaming') return; // a terminal frame already landed, or the card is gone
		if (outcome.kind === 'stopped') this.commit(interruptNode(this.graph, id));
		else if (outcome.kind === 'timed_out') this.commit(failNode(this.graph, id, TIMEOUT_ERROR));
		else if (outcome.kind === 'failed') {
			// A body that breaks after the reply opened is a dropped connection — which is also what the
			// browser does to every open stream as a tab reloads or closes, just before `pagehide`. Keep
			// the partial reply as "Stopped" (interruptNode's contract). Failures the server reports
			// arrive as an ApiCallError or an `error` frame and stay errors.
			this.commit(outcome.error instanceof ApiCallError ? failNode(this.graph, id, toNodeError(outcome.error)) : interruptNode(this.graph, id));
		}
	}

	stop(id: string): void {
		this.streams.stop(id);
	}

	moved(id: string, position: Point): void {
		this.commit(moveNode(this.graph, id, position));
	}

	tidy(): void {
		this.commit(tidyLayout(this.graph, this.width, this.measure()));
		this.layoutVersion++;
	}

	/** Deletes a card and everything below it. Undo can bring it back for `UNDO_MS`. */
	remove(id: string): void {
		if (!this.graph.nodesById[id]) return;
		const { graph, removed } = extractBranch(this.graph, id);
		const gone = new Set(removed.map((n) => n.id));
		this.commit(graph);
		// Only now that the graph has lost them, so the stopped streams find nothing to settle.
		for (const node of removed) if (node.status === 'streaming') this.streams.stop(node.id);
		const clearedTarget = this.target !== null && gone.has(this.target) ? this.target : null;
		if (clearedTarget) {
			this.target = null;
			this.saver.markView();
		}
		if (this.following && gone.has(this.following)) this.following = null;
		this.saver.markDeleted(id);
		this.setUndo({
			rootId: id,
			removed: removed.map((n) => (n.status === 'streaming' ? { ...n, status: 'interrupted' as const } : n)),
			clearedTarget
		});
		this.layoutVersion++;
	}

	/** Puts the last deleted branch back, and the composer target with it if nothing else took its place. */
	undoRemove(): void {
		const undo = this.undo;
		if (!undo) return;
		this.setUndo(null);
		let graph: ConversationGraph;
		try {
			graph = restoreBranch(this.graph, undo.removed);
		} catch {
			return; // its parent is gone since: nothing to hang it on
		}
		this.saver.cancelDeletion(undo.rootId);
		this.commit(graph); // every restored node is new to the graph, so every one is saved again, parents first
		if (undo.clearedTarget && this.target === null) {
			this.target = undo.clearedTarget;
			this.saver.markView();
		}
		this.layoutVersion++;
	}

	private setUndo(undo: UndoState | null): void {
		if (this.undoTimer !== null) clearTimeout(this.undoTimer);
		this.undoTimer = undo ? setTimeout(() => this.setUndo(null), UNDO_MS) : null;
		this.undo = undo;
	}
}

const KEY = Symbol('canvas');
export const provideCanvas = (store: CanvasStore) => setContext(KEY, store);
export const useCanvas = () => getContext<CanvasStore>(KEY);
```

Compared with the store after Task 2:
- `send` now goes through `createAndStream`, and so do `continueReply` and `regenerate`.
- `createAndStream` passes the cards' real widths to layout.
- The saver gets `remove`.
- `streamBlockedReason` is split out of `sendBlockedReason`.
- Everything else is unchanged.

- [ ] **Step 4: The card, the toast, the copy**

In `src/lib/canvas/copy.ts`, add to `PORT_RULED`:

```ts
  /* Plan 3: the card's delete button (the old app's hard-coded label). */
  "node.action.delete": "Delete",
```

Replace `src/lib/components/canvas/NodeCard.svelte` with:

```svelte
<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { copy } from '$lib/canvas/copy';
	import { presentError } from '$lib/canvas/errors';
	import { canBranchFrom, canContinue, canRegenerate, canRetry, CONTINUE_PROMPT } from '$lib/canvas/graph';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import Markdown from './Markdown.svelte';

	let { id }: NodeProps = $props();
	const store = useCanvas();
	const node = $derived(store.graph.nodesById[id]);
	const isTarget = $derived(store.target === id);
	const queued = $derived(store.queuePosition(id));
	const failure = $derived(node?.status === 'error' && node.error ? presentError(node.error) : null);
	const status = $derived.by(() => {
		if (!node) return '';
		if (queued !== null) return copy('node.status.queued', { n: queued });
		if (node.status === 'streaming' && node.response === '') return copy('node.status.thinking');
		if (node.status === 'interrupted') return copy('node.status.stopped');
		if (failure) return failure.category;
		return '';
	});
	// When each applies is graph.ts's call. Only a failed card pays for the child lookup Retry needs.
	const retryable = $derived(node?.status === 'error' && canRetry(store.graph, id));
	const continuable = $derived(!!node && canContinue(node));
	const regenerable = $derived(
		!!node && (node.status === 'interrupted' || (node.status === 'error' && !retryable)) && canRegenerate(store.graph, id)
	);
	const blocked = $derived(store.streamBlockedReason);

	// A streaming body follows its newest line unless the reader scrolled up.
	let body = $state<HTMLDivElement>();
	let stick = true;
	$effect(() => {
		void node?.response;
		if (body && stick && node?.status === 'streaming') body.scrollTop = body.scrollHeight;
	});
</script>

{#if node}
	<article
		class="card"
		class:target={isTarget}
		data-node-id={id}
		data-parent-id={node.parentId ?? ''}
		data-status={node.status}
		style:width="{store.width}px"
	>
		<Handle type="target" position={Position.Top} isConnectable={false} />
		<header>
			{#if node.prompt === CONTINUE_PROMPT}
				<h3 class="prompt continued">{copy('node.continuedFrom')}</h3>
			{:else}
				<h3 class="prompt" title={node.prompt}>{node.prompt}</h3>
			{/if}
			{#if status}<span class="status">{status}</span>{/if}
			{#if node.status === 'streaming'}
				<button class="nodrag" type="button" onclick={() => store.stop(id)}>Stop</button>
			{/if}
			<button
				class="nodrag"
				type="button"
				aria-label="Branch"
				title={canBranchFrom(node)
					? undefined
					: copy(node.status === 'error' || node.status === 'interrupted' ? 'branch.failed' : 'branch.disabled')}
				disabled={!canBranchFrom(node)}
				onclick={() => store.branch(id)}>{copy('node.action.branch')}</button
			>
			<button
				class="nodrag icon"
				type="button"
				aria-label={copy('node.action.delete')}
				title={copy('node.action.delete')}
				onclick={() => store.remove(id)}><span aria-hidden="true">✕</span></button
			>
		</header>
		{#if node.thinking}
			<details class="thinking nodrag nowheel">
				<summary>{copy('node.thinking')}</summary>
				<p>{node.thinking}</p>
			</details>
		{/if}
		<div
			class="body nowheel"
			data-testid="card-body"
			bind:this={body}
			onscroll={() => {
				if (body) stick = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
			}}
		>
			{#if node.response}
				<Markdown text={node.response} streaming={node.status === 'streaming'} />
			{:else if node.status === 'streaming'}
				<span class="pending">…</span>
			{/if}
			{#if failure}<p class="error" role="status">{failure.message}</p>{/if}
		</div>
		{#if retryable || continuable || regenerable}
			<footer class="actions">
				{#if retryable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.retry(id)}
						>{copy('node.action.retry')}</button
					>
				{/if}
				{#if continuable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.continueReply(id)}
						>{copy('node.action.continue')}</button
					>
				{/if}
				{#if regenerable}
					<button class="nodrag" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.regenerate(id)}
						>{copy('node.action.regenerate')}</button
					>
				{/if}
			</footer>
		{/if}
		<Handle type="source" position={Position.Bottom} isConnectable={false} />
	</article>
{/if}

<style>
	.card {
		background: var(--cy-paper-lift);
		color: var(--cy-ink);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-md);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
		font: var(--text-sm);
	}
	.card.target {
		border-color: var(--cy-gold);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--cy-gold) 40%, transparent);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--cy-paper-edge);
	}
	.prompt {
		flex: 1;
		margin: 0;
		font: inherit;
		font-weight: var(--weight-user-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.continued {
		font-style: italic;
		color: var(--cy-ink-soft);
	}
	.status {
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
	button {
		font: var(--text-xs);
		min-height: 28px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.icon {
		padding: 0 var(--space-2);
	}
	.primary {
		background: var(--cy-gold);
		color: var(--cy-paper-deep);
		border-color: transparent;
	}
	.thinking {
		padding: var(--space-2) var(--space-3) 0;
		color: var(--cy-ink-soft);
		font: var(--text-xs);
	}
	.thinking p {
		white-space: pre-wrap;
		max-height: 160px;
		overflow: auto;
	}
	.body {
		padding: var(--space-3);
		max-height: 360px;
		overflow: auto;
		user-select: text;
	}
	.error {
		margin: var(--space-2) 0 0;
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3);
	}
</style>
```

Create `src/lib/components/canvas/UndoToast.svelte`:

```svelte
<!-- The undo toast: one level, for UNDO_MS; Cmd/Ctrl+Z does the same (Task 10). -->
<script lang="ts">
	import { copy } from '$lib/canvas/copy';
	import { useCanvas } from '$lib/canvas/store.svelte';

	const store = useCanvas();
	const message = $derived(
		store.undo
			? store.undo.removed.length === 1
				? copy('delete.undo')
				: copy('delete.undo.subtree', { n: store.undo.removed.length - 1 })
			: ''
	);
</script>

{#if store.undo}
	<div class="toast" role="status">
		<span>{message}</span>
		<button type="button" onclick={() => store.undoRemove()}>{copy('delete.undo.action')}</button>
	</div>
{/if}

<style>
	.toast {
		position: absolute;
		left: 50%;
		bottom: var(--space-4);
		transform: translateX(-50%);
		z-index: var(--z-toast);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
		font: var(--text-sm);
	}
	button {
		font: inherit;
		color: var(--cy-gold);
		background: none;
		border: 0;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
```

In `src/lib/components/canvas/Canvas.svelte`:
- Import `UndoToast from './UndoToast.svelte'`.
- Render `<UndoToast />` inside the `.flow` div, after the `EmptyState` line.

- [ ] **Step 5: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS. There are 6 new card tests, and every earlier browser test passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/store.svelte.ts src/lib/canvas/copy.ts src/lib/components/canvas/NodeCard.svelte src/lib/components/canvas/UndoToast.svelte src/lib/components/canvas/Canvas.svelte tests/e2e/cards.spec.ts
git commit -m "feat(canvas): Retry, Continue, Regenerate, and Delete with Undo

Retry re-sends into the same card (only while it has no replies), Continue
asks for the rest in a card below, Regenerate asks again beside it. Delete
stops the branch's streams, clears the composer if its target was inside,
and queues the server delete behind the saves; Undo restores the branch as
it was, a mid-reply card as Stopped.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 8: Card size and collapse

Spec §4 lists three card size controls:
- **Manual resize**, by dragging the handle. The keyboard half, Cmd/Ctrl+Alt+arrows, arrives in Task 10.
- **Body collapse to one line.**
- **Subtree collapse, with a hidden-count chip.**

Constants and labels come from the old app (`layout.ts`, `node-card.tsx`): 240–640 × 120–900, "Collapse to one line" and "Show full reply", "Collapse" and "Expand (n)".

**Resize.** A resized card keeps its size, and its replies re-centre under it (`reflowChildrenOnCreate`).

**Body collapse.** The card shows one line: the reply's first line, else the failure, else "Thinking", else the prompt. The card is really one line tall. The old app kept a 120 px minimum, which was a defect.

**Subtree collapse.**
- Hides every card below. The hidden cards and their edges are not drawn.
- A chip says how many cards are hidden, and clicking it expands.
- Expanding lays the subtree out under the card again.

**Layout.**
- Tidy lays out only the cards that are drawn.
- Sending to a card hidden inside a collapsed subtree expands its collapsed ancestors, so the reply is drawn too.

**Files:**
- Modify: `src/lib/canvas/store.svelte.ts`, `src/lib/components/canvas/NodeCard.svelte` (full replacement below), `src/lib/components/canvas/Canvas.svelte`, `src/lib/canvas/copy.ts`, `src/lib/canvas/copy.test.ts`
- Create: `tests/e2e/sizes.spec.ts`

**Interfaces:**
- **Consumes:**
  - Task 4: `graphStructure`, `visibleGraph`, `adoptPositions`, `expandPath`.
  - From `graph.ts`: `setCollapsed`, `setBodyCollapsed`, `resizeNode`.
  - From `layout.ts`: `NODE_WIDTH_MIN`, `NODE_WIDTH_MAX`, `NODE_HEIGHT_MIN`, `NODE_HEIGHT_MAX`, `nodeWidthsFrom`.
  - `NodeResizeControl` from `@xyflow/svelte`.
- **Produces (store):**
  - `readonly structure: GraphStructure`, rebuilt when `layoutVersion` changes.
  - `childCount(id): number` and `hiddenBelow(id): number`.
  - `toggleCollapsed(id)` and `toggleBodyCollapsed(id)`.
  - `resized(id, size)`, which clamps to 240–640 × 120–900 and re-centres the replies.
  - `tidy()` now lays out the drawn cards only.
  - `createAndStream` now expands the parent's collapsed ancestors first.
- **Produces (DOM):**
  - Header buttons labelled "Collapse to one line" / "Show full reply", and "Collapse" / "Expand (n)". The second pair only appears when the card has replies.
  - `[data-testid="card-oneline"]`.
  - The chip button "{n} hidden".
  - `.svelte-flow__resize-control`, labelled "Resize card".
  - Flow nodes carry `width` and `height` from `node.size`. Height is dropped while the body is collapsed.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/canvas/copy.test.ts`:

```ts
test("renders the collapse counts", () => {
  assert.equal(copy("node.hiddenCount", { n: 3 }), "3 hidden");
  assert.equal(copy("node.action.expand", { n: 3 }), "Expand (3)");
});
```

Create `tests/e2e/sizes.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { fit, savedNodesText, send, settled } from './helpers';

test('dragging the corner resizes a card, and the size survives a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'resize me');
	await settled(page);
	const card = page.locator(`article[data-node-id="${id}"]`);
	const before = (await card.boundingBox())!;
	await card.hover();
	const handle = (await card.locator('.svelte-flow__resize-control').boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2 + 60, { steps: 20 });
	await page.mouse.up();
	const after = (await card.boundingBox())!;
	expect(after.width - before.width).toBeGreaterThan(50);
	await expect.poll(() => savedNodesText(page)).toMatch(/"width":\d/);
	await page.reload();
	const reloaded = (await page.locator(`article[data-node-id="${id}"]`).boundingBox())!;
	expect(Math.abs(reloaded.width - after.width)).toBeLessThan(4);
});

test("collapsing a card's body leaves one line; expanding brings the reply back", async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'fold me');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await card.getByRole('button', { name: 'Collapse to one line' }).click();
	await expect(card.getByTestId('card-oneline')).toHaveText(/^Echo: fold me\./);
	await expect(card.getByTestId('card-body')).toHaveCount(0);
	expect((await card.boundingBox())!.height).toBeLessThan(110); // one line, not the old app's 120 px floor
	await card.getByRole('button', { name: 'Show full reply' }).click();
	await expect(card.getByTestId('card-body')).toBeVisible();
});

test('collapsing a subtree hides the cards below and says how many', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'top');
	const b = await send(page, 'middle');
	const c = await send(page, 'bottom');
	const top = page.locator(`article[data-node-id="${a}"]`);
	await top.getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toHaveCount(0);
	await expect(page.locator(`article[data-node-id="${c}"]`)).toHaveCount(0);
	await expect(top.getByRole('button', { name: '2 hidden' })).toBeVisible();
	await expect.poll(() => savedNodesText(page)).toContain('"collapsed":true');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toHaveCount(0);
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: '2 hidden' }).click();
	await fit(page);
	await expect(page.locator(`article[data-node-id="${c}"]`)).toBeVisible();
});

test('sending to a card hidden by a collapse expands it, so the reply is drawn', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'outer');
	const b = await send(page, 'inner'); // the composer now replies to b
	await page.locator(`article[data-node-id="${a}"]`).getByRole('button', { name: 'Collapse', exact: true }).click();
	await expect(page.locator(`article[data-node-id="${b}"]`)).toHaveCount(0);
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', b);
	const c = await send(page, 'reply to the hidden card');
	await expect(page.locator(`article[data-node-id="${c}"]`)).toHaveAttribute('data-parent-id', b);
	await expect(page.locator(`article[data-node-id="${b}"]`)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test && pnpm test:e2e`
Expected: FAIL — the copy keys and the controls do not exist.

- [ ] **Step 3: Store**

In `src/lib/canvas/store.svelte.ts`:
- Import `untrack` from `'svelte'`.
- Add to the `./graph` import: `adoptPositions`, `expandPath`, `graphStructure`, `resizeNode`, `setBodyCollapsed`, `setCollapsed`, `visibleGraph`.
- Add to the `./layout` import: `NODE_HEIGHT_MAX`, `NODE_HEIGHT_MIN`, `NODE_WIDTH_MAX`, `NODE_WIDTH_MIN`.

Then make these changes:

1. After the `undo` field:

```ts
	/** Children, and the cards a collapse hides — rebuilt only when the structure can have changed. */
	readonly structure = $derived.by(() => {
		void this.layoutVersion;
		return untrack(() => graphStructure(this.graph));
	});
```

2. After `queuePosition`:

```ts
	childCount(id: string): number {
		return this.structure.children.get(id)?.length ?? 0;
	}

	/** How many cards a collapse on `id` hides: everything below it, not only its direct replies. */
	hiddenBelow(id: string): number {
		const { children } = this.structure;
		const queue = [...(children.get(id) ?? [])];
		let count = 0;
		while (queue.length > 0) {
			count += 1;
			queue.push(...(children.get(queue.pop()!) ?? []));
		}
		return count;
	}
```

3. In `createAndStream`, the first line becomes:

```ts
		// A reply to a card inside a collapsed subtree would be born hidden: show the way down first.
		let graph = parentId ? expandPath(this.graph, parentId) : this.graph;
```

4. Replace `tidy()`, and add the size and collapse actions after it:

```ts
	/** Tidy lays out the cards that are drawn; hidden ones keep their place until their subtree opens. */
	tidy(): void {
		const laidOut = tidyLayout(visibleGraph(this.graph), this.width, this.measure(), nodeWidthsFrom(this.graph, this.width));
		this.commit(adoptPositions(this.graph, laidOut));
		this.layoutVersion++;
	}

	/** Hides or shows everything below a card. Showing lays the subtree out under it again. */
	toggleCollapsed(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node || this.childCount(id) === 0) return;
		let graph = setCollapsed(this.graph, id, !node.collapsed);
		if (node.collapsed) graph = reflowChildrenOnCreate(graph, id, this.width, this.measure(), nodeWidthsFrom(graph, this.width));
		this.commit(graph);
		this.layoutVersion++;
	}

	/** One line instead of the whole card, or back. */
	toggleBodyCollapsed(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node) return;
		this.commit(setBodyCollapsed(this.graph, id, !node.bodyCollapsed));
		this.layoutVersion++; // a resized card's flow node drops, or gets back, its fixed height
	}

	/** A card's new size (handle or keyboard), clamped to the old app's bounds; its replies re-centre under it. */
	resized(id: string, size: { width: number; height: number }): void {
		if (!this.graph.nodesById[id]) return;
		const clamped = {
			width: Math.round(Math.min(NODE_WIDTH_MAX, Math.max(NODE_WIDTH_MIN, size.width))),
			height: Math.round(Math.min(NODE_HEIGHT_MAX, Math.max(NODE_HEIGHT_MIN, size.height)))
		};
		let graph = resizeNode(this.graph, id, clamped);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local copy for one layout call, never observed
		const heights = new Map(this.measure());
		heights.set(id, clamped.height);
		graph = reflowChildrenOnCreate(graph, id, this.width, heights, nodeWidthsFrom(graph, this.width));
		this.commit(graph);
		this.layoutVersion++;
	}
```

- [ ] **Step 4: Canvas, card and copy**

In `src/lib/components/canvas/Canvas.svelte`, the `layoutVersion` effect builds the flow nodes and edges from the drawn cards only, and carries sizes:

```ts
	// Graph → flow nodes, only when layout or structure changed. Tokens never pass through here.
	$effect(() => {
		void store.layoutVersion;
		untrack(() => {
			const graph = store.graph;
			const { hidden } = store.structure;
			const prev = new Map(nodes.map((n) => [n.id, n]));
			nodes = graph.nodeIds
				.filter((id) => !hidden.has(id))
				.map((id) => {
					const node = graph.nodesById[id];
					const width = node.size?.width;
					const height = node.size && !node.bodyCollapsed ? node.size.height : undefined;
					const p = prev.get(id);
					if (p && p.position.x === node.position.x && p.position.y === node.position.y && p.width === width && p.height === height) return p;
					return { ...(p ?? { id, type: 'card', data: {} }), position: node.position, width, height };
				});
			edges = graph.nodeIds
				.filter((id) => !hidden.has(id) && graph.nodesById[id].parentId)
				.map((id) => ({ id: `e-${id}`, source: graph.nodesById[id].parentId!, target: id }));
		});
	});
```

In `src/lib/canvas/copy.ts`, add to `PORT_RULED`:

```ts
  /* Plan 3: card size controls — the old app's hard-coded labels (node-card.tsx at c215512). */
  "node.action.collapseBody": "Collapse to one line",
  "node.action.expandBody": "Show full reply",
  "node.action.collapse": "Collapse",
  "node.action.expand": "Expand ({n})",
  "node.action.resize": "Resize card",
  /* Plan 3: the chip on a collapsed card — the spec asks for a hidden-count chip and gives no wording. */
  "node.hiddenCount": "{n} hidden",
```

Replace `src/lib/components/canvas/NodeCard.svelte` with:

```svelte
<script lang="ts">
	import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/svelte';
	import { copy } from '$lib/canvas/copy';
	import { presentError } from '$lib/canvas/errors';
	import { canBranchFrom, canContinue, canRegenerate, canRetry, CONTINUE_PROMPT, type ConversationNode } from '$lib/canvas/graph';
	import { NODE_HEIGHT_MAX, NODE_HEIGHT_MIN, NODE_WIDTH_MAX, NODE_WIDTH_MIN } from '$lib/canvas/layout';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import Markdown from './Markdown.svelte';

	let { id, width, height }: NodeProps = $props();
	const store = useCanvas();
	const node = $derived(store.graph.nodesById[id]);
	const isTarget = $derived(store.target === id);
	const queued = $derived(store.queuePosition(id));
	const failure = $derived(node?.status === 'error' && node.error ? presentError(node.error) : null);
	const status = $derived.by(() => {
		if (!node) return '';
		if (queued !== null) return copy('node.status.queued', { n: queued });
		if (node.status === 'streaming' && node.response === '') return copy('node.status.thinking');
		if (node.status === 'interrupted') return copy('node.status.stopped');
		if (failure) return failure.category;
		return '';
	});
	// When each applies is graph.ts's call. Only a failed card pays for the child lookup Retry needs.
	const retryable = $derived(node?.status === 'error' && canRetry(store.graph, id));
	const continuable = $derived(!!node && canContinue(node));
	const regenerable = $derived(
		!!node && (node.status === 'interrupted' || (node.status === 'error' && !retryable)) && canRegenerate(store.graph, id)
	);
	const blocked = $derived(store.streamBlockedReason);
	/** A resized card has a fixed height — except while its body is collapsed, when it is one line. */
	const sized = $derived(height !== undefined && !node?.bodyCollapsed);
	const children = $derived(store.childCount(id));
	const hiddenCount = $derived(node?.collapsed ? store.hiddenBelow(id) : 0);
	const oneLine = $derived(node?.bodyCollapsed ? summaryLine(node) : '');

	/** The collapsed body's one line: the reply's first line, else the failure, else "Thinking", else the prompt. */
	function summaryLine(n: ConversationNode): string {
		const line = firstLine(n.response);
		if (line) return line;
		if (n.error) return n.error.message;
		if (n.status === 'streaming') return copy('node.status.thinking');
		return n.prompt;
	}

	/** Scans line by line, so a long reply is not split in full. */
	function firstLine(text: string): string {
		for (let start = 0; start < text.length; ) {
			const end = text.indexOf('\n', start);
			const line = text.slice(start, end === -1 ? text.length : end).trim();
			if (line) return line;
			if (end === -1) break;
			start = end + 1;
		}
		return '';
	}

	// A streaming body follows its newest line unless the reader scrolled up.
	let body = $state<HTMLDivElement>();
	let stick = true;
	$effect(() => {
		void node?.response;
		if (body && stick && node?.status === 'streaming') body.scrollTop = body.scrollHeight;
	});
</script>

{#if node}
	<article
		class="card"
		class:target={isTarget}
		class:sized
		data-node-id={id}
		data-parent-id={node.parentId ?? ''}
		data-status={node.status}
		style:width="{width ?? store.width}px"
		style:height={sized ? `${height}px` : undefined}
	>
		<Handle type="target" position={Position.Top} isConnectable={false} />
		<header>
			{#if node.prompt === CONTINUE_PROMPT}
				<h3 class="prompt continued">{copy('node.continuedFrom')}</h3>
			{:else}
				<h3 class="prompt" title={node.prompt}>{node.prompt}</h3>
			{/if}
			{#if status}<span class="status">{status}</span>{/if}
			{#if node.status === 'streaming'}
				<button class="nodrag" type="button" onclick={() => store.stop(id)}>Stop</button>
			{/if}
			<button
				class="nodrag"
				type="button"
				aria-label="Branch"
				title={canBranchFrom(node)
					? undefined
					: copy(node.status === 'error' || node.status === 'interrupted' ? 'branch.failed' : 'branch.disabled')}
				disabled={!canBranchFrom(node)}
				onclick={() => store.branch(id)}>{copy('node.action.branch')}</button
			>
			<button
				class="nodrag icon"
				type="button"
				aria-label={copy(node.bodyCollapsed ? 'node.action.expandBody' : 'node.action.collapseBody')}
				title={copy(node.bodyCollapsed ? 'node.action.expandBody' : 'node.action.collapseBody')}
				onclick={() => store.toggleBodyCollapsed(id)}><span aria-hidden="true">{node.bodyCollapsed ? '▤' : '—'}</span></button
			>
			{#if children > 0}
				<button
					class="nodrag icon"
					type="button"
					aria-expanded={!node.collapsed}
					aria-label={node.collapsed ? copy('node.action.expand', { n: hiddenCount }) : copy('node.action.collapse')}
					title={node.collapsed ? copy('node.action.expand', { n: hiddenCount }) : copy('node.action.collapse')}
					onclick={() => store.toggleCollapsed(id)}><span aria-hidden="true">{node.collapsed ? '▸' : '▾'}</span></button
				>
			{/if}
			<button
				class="nodrag icon"
				type="button"
				aria-label={copy('node.action.delete')}
				title={copy('node.action.delete')}
				onclick={() => store.remove(id)}><span aria-hidden="true">✕</span></button
			>
		</header>
		{#if node.bodyCollapsed}
			<p class="oneline" data-testid="card-oneline" title={oneLine}>{oneLine}</p>
		{:else}
			{#if node.thinking}
				<details class="thinking nodrag nowheel">
					<summary>{copy('node.thinking')}</summary>
					<p>{node.thinking}</p>
				</details>
			{/if}
			<div
				class="body nowheel"
				data-testid="card-body"
				bind:this={body}
				onscroll={() => {
					if (body) stick = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
				}}
			>
				{#if node.response}
					<Markdown text={node.response} streaming={node.status === 'streaming'} />
				{:else if node.status === 'streaming'}
					<span class="pending">…</span>
				{/if}
				{#if failure}<p class="error" role="status">{failure.message}</p>{/if}
			</div>
		{/if}
		{#if retryable || continuable || regenerable}
			<footer class="actions">
				{#if retryable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.retry(id)}
						>{copy('node.action.retry')}</button
					>
				{/if}
				{#if continuable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.continueReply(id)}
						>{copy('node.action.continue')}</button
					>
				{/if}
				{#if regenerable}
					<button class="nodrag" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.regenerate(id)}
						>{copy('node.action.regenerate')}</button
					>
				{/if}
			</footer>
		{/if}
		{#if node.collapsed && hiddenCount > 0}
			<button class="nodrag chip" type="button" onclick={() => store.toggleCollapsed(id)}>{copy('node.hiddenCount', { n: hiddenCount })}</button>
		{/if}
		{#if !node.bodyCollapsed}
			<NodeResizeControl
				minWidth={NODE_WIDTH_MIN}
				maxWidth={NODE_WIDTH_MAX}
				minHeight={NODE_HEIGHT_MIN}
				maxHeight={NODE_HEIGHT_MAX}
				class="resize"
				aria-label={copy('node.action.resize')}
				title={copy('node.action.resize')}
				onResizeEnd={(_event, params) => store.resized(id, { width: params.width, height: params.height })}
			/>
		{/if}
		<Handle type="source" position={Position.Bottom} isConnectable={false} />
	</article>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		background: var(--cy-paper-lift);
		color: var(--cy-ink);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-md);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
		font: var(--text-sm);
	}
	.card.sized {
		overflow: hidden;
	}
	.card.target {
		border-color: var(--cy-gold);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--cy-gold) 40%, transparent);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--cy-paper-edge);
	}
	.prompt {
		flex: 1;
		margin: 0;
		font: inherit;
		font-weight: var(--weight-user-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.continued {
		font-style: italic;
		color: var(--cy-ink-soft);
	}
	.status {
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
	button {
		font: var(--text-xs);
		min-height: 28px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.icon {
		padding: 0 var(--space-2);
	}
	.primary {
		background: var(--cy-gold);
		color: var(--cy-paper-deep);
		border-color: transparent;
	}
	.thinking {
		padding: var(--space-2) var(--space-3) 0;
		color: var(--cy-ink-soft);
		font: var(--text-xs);
	}
	.thinking p {
		white-space: pre-wrap;
		max-height: 160px;
		overflow: auto;
	}
	.body {
		padding: var(--space-3);
		max-height: 360px;
		overflow: auto;
		user-select: text;
	}
	.card.sized .body {
		flex: 1;
		min-height: 0;
		max-height: none;
	}
	.oneline {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--cy-ink-soft);
	}
	.error {
		margin: var(--space-2) 0 0;
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3);
	}
	.chip {
		align-self: flex-start;
		margin: 0 var(--space-3) var(--space-3);
		border-radius: var(--radius-full);
	}
	.card :global(.svelte-flow__resize-control.resize) {
		width: 14px;
		height: 14px;
		border: 0;
		border-radius: 3px;
		background: var(--cy-gold);
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease-out);
	}
	.card:hover :global(.svelte-flow__resize-control.resize),
	.card:focus-within :global(.svelte-flow__resize-control.resize) {
		opacity: 1;
	}
</style>
```

- [ ] **Step 5: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS. There is 1 new copy test and 4 new size tests, and every earlier test still passes. If `svelte-check` reports that `NodeResizeControl` takes a prop under a different name in 1.7.0, use the name its types report, keep the behaviour, and list the change in the report.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/store.svelte.ts src/lib/canvas/copy.ts src/lib/canvas/copy.test.ts src/lib/components/canvas/NodeCard.svelte src/lib/components/canvas/Canvas.svelte tests/e2e/sizes.spec.ts
git commit -m "feat(canvas): resize cards, collapse a body to one line, collapse a subtree

A resized card keeps its size and its replies re-centre under it. A
collapsed body is really one line. A collapsed subtree is not drawn, a chip
says how many cards it hides, Tidy lays out only what is drawn, and a reply
to a hidden card opens the way down to it.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---
### Task 9: Focus path, linear view and the shortcuts sheet

**Focus path.** Spec §4 says cards off the root → target path are dimmed.
- The old app dimmed only the edges and toggled the effect with `F`. Here the cards dim too, as the spec says.
- The setting is on by default, and the choice is remembered (localStorage `nc:focusPath`).
- `F`, wired in Task 10, or the top-bar "Focus path" button toggles it.
- A dimmed card comes back to full strength under the pointer or with focus inside it.
- Edges on the path are drawn in gold; the others fade.

**Linear view.** This is spec §4's transcript view. The old app called it the Linear view (`linear-view.tsx`).
- It is a right-hand panel showing the root → target path as plain text.
- "Copy all" copies `You: …\n\nAssistant: …`, with exchanges joined by `\n\n---\n\n`. Thinking is never included.
- It opens from the top bar, and `T` (Task 10) toggles it.

**Shortcuts sheet.** A modal `<dialog>` that lists `SHORTCUT_ROWS`. It opens from a top-bar "?" button, or `?` (Task 10), and closes on Esc or its Close button.

**Files:**
- Modify: `src/lib/canvas/store.svelte.ts`, `src/lib/components/canvas/NodeCard.svelte`, `src/lib/components/canvas/Canvas.svelte`, `src/lib/components/canvas/CanvasApp.svelte`, `src/lib/components/canvas/TopBar.svelte`, `src/lib/canvas/copy.ts`
- Create: `src/lib/canvas/transcript.ts`, `src/lib/canvas/transcript.test.ts`, `src/lib/components/canvas/LinearView.svelte`, `src/lib/components/canvas/ShortcutsSheet.svelte`, `tests/e2e/focus.spec.ts`

**Interfaces:**
- **Consumes:**
  - `SHORTCUT_ROWS` from Task 5.
  - `store.structure` from Task 8.
  - `pathToRoot`.
  - The copy keys `focuspath.toggle`, `linearview.heading`, `linearview.copyAll`, `linearview.close`, `shortcuts.title` and `shortcuts.close`. They already exist.
- **Produces (store):**
  - `focusPath: boolean` and `toggleFocusPath()`.
  - `readonly pathIds: ReadonlySet<string> | null`.
  - `dimmed(id): boolean`.
  - `transcriptOpen: boolean` and `shortcutsOpen: boolean`.
- **Produces (other):**
  - `transcriptText(path: readonly { prompt: string; response: string }[]): string`.
  - Copy keys `linearview.copied` and `linearview.empty`.
- **Produces (DOM):**
  - `article.dim` on dimmed cards.
  - Edges carry `class: 'on-path' | 'off-path'` while the focus path is on and there is a target.
  - The region named "Linear view", with `.you` and `.reply` paragraphs.
  - The dialog named "Keyboard shortcuts".
  - Top-bar buttons "Focus path" (with `aria-pressed`), "Linear view" (with `aria-pressed`), and "?" (labelled "Keyboard shortcuts").

- [ ] **Step 1: Write the failing tests**

`src/lib/canvas/transcript.test.ts`:

```ts
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
});
```

`tests/e2e/focus.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { fit, send } from './helpers';

test('cards off the path to the composer target are dimmed, and the toggle turns it off', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'first root');
	const b = await send(page, 'its reply');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const c = await send(page, 'second root');
	const card = (id: string) => page.locator(`article[data-node-id="${id}"]`);
	await fit(page);
	await expect(card(a)).toHaveClass(/\bdim\b/);
	await expect(card(b)).toHaveClass(/\bdim\b/);
	await expect(card(c)).not.toHaveClass(/\bdim\b/);
	await card(a).getByRole('button', { name: 'Branch' }).click();
	await expect(card(a)).not.toHaveClass(/\bdim\b/);
	await expect(card(b)).toHaveClass(/\bdim\b/); // below the target is off the root → target path
	await expect(card(c)).toHaveClass(/\bdim\b/);
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(page.locator('article.dim')).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('article.dim')).toHaveCount(0);
});

test('the linear view shows the path to the target and copies it', async ({ page, context, signIn }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await signIn();
	await page.goto('/canvas');
	await send(page, 'question one');
	await send(page, 'question two');
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel.locator('.you')).toHaveText(['question one', 'question two']);
	await expect(panel.locator('.reply').first()).toContainText('Echo: question one.');
	await panel.getByRole('button', { name: 'Copy all' }).click();
	await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
	const text = await page.evaluate(() => navigator.clipboard.readText());
	expect(text).toMatch(/^You: question one\n\nAssistant: Echo: question one\.[\s\S]*\n\n---\n\nYou: question two\n\nAssistant: Echo: question two\./);
	await panel.getByRole('button', { name: 'Close linear view' }).click();
	await expect(panel).toHaveCount(0);
});

test('the shortcuts sheet lists all 21 shortcuts', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
	const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(sheet.locator('kbd')).toHaveCount(21);
	await expect(sheet).toContainText('Move focus to parent / first child / sibling');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test && pnpm test:e2e`
Expected: FAIL — `./transcript` not found; no dimming, panel or sheet.

- [ ] **Step 3: Store, transcript, copy**

`src/lib/canvas/transcript.ts`:

```ts
/** The linear view's "Copy all": each exchange as You / Assistant, separated by a rule (the old app's format). */
export function transcriptText(path: readonly { prompt: string; response: string }[]): string {
	return path.map((n) => `You: ${n.prompt}\n\nAssistant: ${n.response}`).join('\n\n---\n\n');
}
```

In `src/lib/canvas/store.svelte.ts`, add two module-level helpers after the `UndoState` type:

```ts
/** A remembered on/off choice. Private mode or blocked storage just means it is not remembered. */
function readFlag(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value === '1';
	} catch {
		return fallback;
	}
}

function writeFlag(key: string, value: boolean): void {
	try {
		localStorage.setItem(key, value ? '1' : '0');
	} catch {
		// the choice just won't persist
	}
}
```

Then add these fields after `structure`:

```ts
	/** Dim the cards off the root → target path (spec §4). On by default; `F` or the top-bar button toggles it. */
	focusPath = $state(readFlag('nc:focusPath', true));
	transcriptOpen = $state(false);
	shortcutsOpen = $state(false);

	/** The root → target path, or null without a target. Rebuilt when the target or the structure changes, never per token. */
	readonly pathIds = $derived.by(() => {
		void this.layoutVersion;
		const target = this.target;
		return untrack(() =>
			target && this.graph.nodesById[target]
				? // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a snapshot rebuilt whole, never mutated
					new Set(pathToRoot(this.graph, target).map((n) => n.id))
				: null
		);
	});
```

And these methods after `hiddenBelow`:

```ts
	dimmed(id: string): boolean {
		return this.focusPath && this.pathIds !== null && !this.pathIds.has(id);
	}

	toggleFocusPath(): void {
		this.focusPath = !this.focusPath;
		writeFlag('nc:focusPath', this.focusPath);
	}
```

In `src/lib/canvas/copy.ts`, add to `PORT_RULED`:

```ts
  /* Plan 3: the linear view's copy confirmation (the old app's hard-coded "Copied"), and its empty state
   * (the old app never showed an empty panel; this port opens it without a target too). */
  "linearview.copied": "Copied",
  "linearview.empty":
    "Nothing here yet. Send a message, or branch from a card, and its conversation shows here as text.",
```

- [ ] **Step 4: Components**

`src/lib/components/canvas/NodeCard.svelte`:
- Add `class:dim={store.dimmed(id)}` to the `article`.
- Add `transition: opacity var(--dur-base) var(--ease-out);` to the `.card` rule.
- Add:

```css
	.card.dim:not(:hover):not(:focus-within) {
		opacity: 0.45;
	}
```

In `src/lib/components/canvas/Canvas.svelte`:
- Delete the `edges = …` statement from the `layoutVersion` effect.
- Add this effect after it:

```ts
	// Edges: on structure changes, and when the target or the focus path changes — still never per token.
	$effect(() => {
		void store.layoutVersion;
		const path = store.pathIds;
		const dim = store.focusPath && path !== null;
		untrack(() => {
			const graph = store.graph;
			const { hidden } = store.structure;
			edges = graph.nodeIds
				.filter((id) => !hidden.has(id) && graph.nodesById[id].parentId)
				.map((id) => {
					const source = graph.nodesById[id].parentId!;
					const onPath = dim && path!.has(id) && path!.has(source);
					return { id: `e-${id}`, source, target: id, class: !dim ? undefined : onPath ? 'on-path' : 'off-path' };
				});
		});
	});
```

- Add to its `<style>`:

```css
	.flow :global(.svelte-flow__edge.off-path) {
		opacity: 0.35;
		transition: opacity var(--dur-base) var(--ease-out);
	}
	.flow :global(.svelte-flow__edge.on-path .svelte-flow__edge-path) {
		stroke: var(--cy-gold);
		stroke-width: 2;
	}
```

(The edge's `class` should land on the `.svelte-flow__edge` group. Check it in the DOM, and adjust the selector if 1.7.0 puts it elsewhere.)

Create `src/lib/components/canvas/LinearView.svelte`:

```svelte
<!-- Spec §4's transcript view (the old app's "Linear view"): the root → target path as plain text. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { copy } from '$lib/canvas/copy';
	import { pathToRoot } from '$lib/canvas/graph';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { transcriptText } from '$lib/canvas/transcript';

	const store = useCanvas();
	const path = $derived(store.target && store.graph.nodesById[store.target] ? pathToRoot(store.graph, store.target) : []);
	let panel = $state<HTMLElement>();
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		// Opened from a key or a button: take focus, and give it back on close.
		const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		panel?.focus();
		return () => {
			clearTimeout(copiedTimer);
			returnTo?.focus({ preventScroll: true });
		};
	});

	async function copyAll() {
		await navigator.clipboard.writeText(transcriptText(path));
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 2000);
	}
</script>

<section class="linear" aria-labelledby="linear-title" tabindex="-1" bind:this={panel}>
	<header>
		<h2 id="linear-title">{copy('linearview.heading')}</h2>
		<button type="button" disabled={path.length === 0} onclick={copyAll}
			>{copied ? copy('linearview.copied') : copy('linearview.copyAll')}</button
		>
		<button type="button" class="close" aria-label={copy('linearview.close')} onclick={() => (store.transcriptOpen = false)}>×</button>
	</header>
	{#if path.length === 0}
		<p class="empty">{copy('linearview.empty')}</p>
	{:else}
		<ol>
			{#each path as node (node.id)}
				<li>
					<p class="you">{node.prompt}</p>
					<p class="reply">{node.response || '…'}</p>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.linear {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(480px, 100%);
		z-index: var(--z-popover);
		overflow: auto;
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		border-left: 1px solid var(--cy-paper-edge);
		font: var(--text-sm);
	}
	.linear:focus {
		outline: none;
	}
	header {
		position: sticky;
		top: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--cy-paper-deep);
		border-bottom: 1px solid var(--cy-paper-edge);
	}
	h2 {
		flex: 1;
		margin: 0;
		font: var(--text-base);
		font-weight: 600;
	}
	button {
		font: var(--text-xs);
		min-height: 28px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		cursor: pointer;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.you {
		font-weight: var(--weight-user-text);
		margin-bottom: var(--space-2);
	}
	.reply {
		color: var(--cy-ink-soft);
	}
	.empty {
		padding: var(--space-4);
		color: var(--cy-ink-soft);
	}
</style>
```

Create `src/lib/components/canvas/ShortcutsSheet.svelte`:

```svelte
<!-- Every canvas shortcut, from the same table the key handler reads. Esc or Close shuts it. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { copy } from '$lib/canvas/copy';
	import { SHORTCUT_ROWS } from '$lib/canvas/shortcuts';
	import { useCanvas } from '$lib/canvas/store.svelte';

	const store = useCanvas();
	let dialog = $state<HTMLDialogElement>();
	onMount(() => dialog?.showModal());
</script>

<dialog bind:this={dialog} aria-labelledby="shortcuts-title" onclose={() => (store.shortcutsOpen = false)}>
	<h2 id="shortcuts-title">{copy('shortcuts.title')}</h2>
	<dl>
		{#each SHORTCUT_ROWS as row (row.keys)}
			<div class="row">
				<dt><kbd>{row.keys}</kbd></dt>
				<dd>{row.does}</dd>
			</div>
		{/each}
	</dl>
	<button type="button" onclick={() => dialog?.close()}>{copy('shortcuts.close')}</button>
</dialog>

<style>
	dialog {
		width: min(520px, calc(100vw - 2 * var(--space-6)));
		padding: var(--space-6);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-lg);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		font: var(--text-sm);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	h2 {
		margin: 0 0 var(--space-4);
		font: var(--text-lg);
	}
	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3) var(--space-4);
		margin: 0 0 var(--space-4);
	}
	dt,
	dd {
		margin: 0;
	}
	kbd {
		font: var(--text-code);
		color: var(--cy-gold);
	}
	dd {
		color: var(--cy-ink-soft);
	}
	button {
		font: var(--text-xs);
		min-height: 28px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		cursor: pointer;
	}
</style>
```

In `src/lib/components/canvas/CanvasApp.svelte`:
- Import `LinearView` and `ShortcutsSheet`.
- Render `{#if store.transcriptOpen}<LinearView />{/if}` and `{#if store.shortcutsOpen}<ShortcutsSheet />{/if}` inside the `.app` div, after `<Composer>`.
- Add `position: relative;` to the `.app` rule.

In `src/lib/components/canvas/TopBar.svelte`, add these buttons after "Fit":

```svelte
	<button type="button" aria-pressed={store.focusPath} onclick={() => store.toggleFocusPath()}>{copy('focuspath.toggle')}</button>
	<button type="button" aria-pressed={store.transcriptOpen} onclick={() => (store.transcriptOpen = !store.transcriptOpen)}
		>{copy('linearview.heading')}</button
	>
	<button type="button" aria-label={copy('shortcuts.title')} title={copy('shortcuts.title')} onclick={() => (store.shortcutsOpen = true)}>?</button>
```

- [ ] **Step 5: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS. There are 2 transcript unit tests and 3 focus browser tests. The interaction and performance specs are unaffected, because dimming changes only when the target or the structure changes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/store.svelte.ts src/lib/canvas/transcript.ts src/lib/canvas/transcript.test.ts src/lib/canvas/copy.ts src/lib/components/canvas tests/e2e/focus.spec.ts
git commit -m "feat(canvas): focus-path dimming, the linear view, and the shortcuts sheet

Cards off the root → target path dim (on by default, remembered; the top-bar
toggle turns it off), edges on the path draw in gold. The linear view shows
that path as text and copies it in the old app's You / Assistant format.
The shortcuts sheet lists the same table the key handler reads.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10: Keyboard

Every row of the shortcuts sheet now works. One `svelte:window` keydown handler in `Canvas.svelte` asks `resolveShortcut` (Task 5) what a key means, then runs it.

**Focus model.** Cards use a roving tabindex: only one card is tabbable at a time. `focusedId` is the card that keyboard commands act on.
- Arrows, Home and End move it with the tree moves from Task 4.
- A click or Tab sets it.
- It is never the composer target.
- When focus moves to a card that is off screen, the canvas pans at its current zoom to show it, then focuses it. Off-screen cards are not rendered under `onlyRenderVisibleElements`.

**Other behaviour.**
- Enter on a focused card binds the composer to it and puts the cursor in the composer. `B` does the same, but only for a card that can be branched from.
- Esc in the composer gives focus back to the card the composer replies to.
- Esc closes the linear view.
- Alt+arrows nudge a card and pin it by hand. Cmd/Ctrl+Alt+arrows resize it.
- Zoom keys anchor on the focused card. Controls gains a visible "Zoom to 100%" button (Plan 2 follow-up M6).
- Svelte Flow's own keyboard handling is switched off (`nodesFocusable`, `edgesFocusable`, `disableKeyboardA11y`), so its arrow keys cannot move cards behind ours.

**Files:**
- Modify: `src/lib/canvas/store.svelte.ts`, `src/lib/components/canvas/Canvas.svelte` (full replacement below), `src/lib/components/canvas/NodeCard.svelte`, `src/lib/components/canvas/Composer.svelte`, `src/lib/canvas/copy.ts`
- Create: `tests/e2e/keyboard.spec.ts`

**Interfaces:**
- **Consumes:**
  - `resolveShortcut` and `Command` from Task 5.
  - `moveFocus` from Task 4.
  - `zoomAt`, `rectInView`, `focusOn`, `ZOOM_STEP_FACTOR` and `Viewport` from `viewport.ts`.
  - Every store action from Tasks 7–9.
  - `ControlButton` from `@xyflow/svelte`.
- **Produces (store):**
  - Fields `focusedId`, `focusRequest` and `composerRequest`.
  - `readonly rovingId`.
  - Methods `focusCard(id)`, `noteFocus(id)`, `bindComposer(id)`, `branchFromCard(id)`, `nudge(id, dx, dy)` and `resizeBy(id, dw, dh)`.
  - `remove()` now moves keyboard focus to the removed card's parent.
- **Produces (other):**
  - Copy key `zoom.reset`.
  - DOM: a card is `tabindex="0"` when it is the roving card and `-1` otherwise. It has `aria-current="true"` when it is the target.

- [ ] **Step 1: Write the failing browser tests** — `tests/e2e/keyboard.spec.ts`

```ts
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { cards, emptyCanvasPoint, fit, savedNodesText, send, settled, viewport } from './helpers';

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-node-id') ?? null);
const card = (page: Page, id: string) => page.locator(`article[data-node-id="${id}"]`);

test('arrows, Home and End move focus along the tree', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const r = await send(page, 'root');
	const a = await send(page, 'first reply');
	const b = await send(page, 'reply to the reply');
	await fit(page);
	await card(page, r).getByRole('button', { name: 'Branch' }).click();
	const s = await send(page, 'second reply');
	await page.getByLabel('Message').press('Escape'); // back to the card the composer replies to
	await expect.poll(() => focused(page)).toBe(s);
	for (const [key, expected] of [
		['Home', r],
		['ArrowDown', a],
		['ArrowRight', s],
		['ArrowLeft', a],
		['ArrowDown', b],
		['ArrowUp', a],
		['End', s]
	] as const) {
		await page.keyboard.press(key);
		await expect.poll(() => focused(page), key).toBe(expected);
	}
});

test('End reaches an off-screen card and focuses it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'top');
	await send(page, 'middle');
	const last = await send(page, 'bottom');
	await page.getByLabel('Message').blur();
	for (let i = 0; i < 2; i++) {
		const p = await emptyCanvasPoint(page);
		await page.mouse.move(p.x, p.y);
		await page.mouse.down();
		await page.mouse.move(p.x + 600, p.y + 500, { steps: 10 });
		await page.mouse.up();
	}
	await expect(cards(page)).toHaveCount(0);
	await page.keyboard.press('End');
	await expect.poll(() => focused(page)).toBe(last);
	await expect(card(page, last)).toBeVisible();
});

test('Enter binds the composer to the focused card; a click focuses a card without changing the target', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const root = await send(page, 'bind root');
	const leaf = await send(page, 'bind leaf');
	await page.getByLabel('Message').press('Escape');
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => focused(page)).toBe(root);
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', root);
	await expect(page.getByLabel('Message')).toBeFocused();
	await card(page, leaf).getByTestId('card-body').click();
	await expect.poll(() => focused(page)).toBe(leaf);
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', root);
});

test('Alt+arrows nudge the focused card and Cmd/Ctrl+Alt+arrows resize it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'nudge me');
	await settled(page);
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	const box = async () => (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	const { zoom } = await viewport(page);
	const before = await box();
	await page.keyboard.press('Alt+ArrowRight');
	await page.keyboard.press('Shift+Alt+ArrowDown');
	await expect.poll(async () => Math.round(((await box()).x - before.x) / zoom)).toBe(16);
	await expect.poll(async () => Math.round(((await box()).y - before.y) / zoom)).toBe(64);
	await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');
	await expect.poll(async () => Math.round(((await box()).width - before.width) / zoom)).toBe(8);
	await expect.poll(() => savedNodesText(page)).toContain('"manual"');
});

test('Delete removes the focused card and Cmd/Ctrl+Z brings it back', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const keep = await send(page, 'keep me');
	const drop = await send(page, 'drop me');
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(drop);
	await page.keyboard.press('Delete');
	await expect(card(page, drop)).toHaveCount(0);
	await expect.poll(() => focused(page)).toBe(keep); // focus moves to the parent
	await page.keyboard.press('ControlOrMeta+z');
	await expect(card(page, drop)).toBeVisible();
});

test('B, R, C and M act on the focused card', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const root = await send(page, 'root');
	const leaf = await send(page, 'leaf');
	await page.getByLabel('Message').press('Escape');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('b');
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', root);
	await expect(page.getByLabel('Message')).toBeFocused();
	await page.getByLabel('Message').press('Escape'); // focus the root again
	await page.keyboard.press('m');
	await expect(card(page, root).getByTestId('card-oneline')).toBeVisible();
	await page.keyboard.press('m');
	await page.keyboard.press('c');
	await expect(card(page, leaf)).toHaveCount(0);
	await page.keyboard.press('c');
	await expect(card(page, leaf)).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focused(page)).toBe(leaf);
	await page.keyboard.press('r');
	const target = page.getByTestId('composer-target');
	await expect(target).not.toHaveAttribute('data-target-id', root);
	const sibling = card(page, (await target.getAttribute('data-target-id'))!);
	await expect(sibling).toHaveAttribute('data-parent-id', root);
	await expect(sibling.locator('.prompt')).toHaveText('leaf');
});

test('Esc stops the focused card while it streams', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] stop with esc', { wait: false });
	await expect(card(page, id)).toContainText('Echo: stop with esc.');
	await page.getByLabel('Message').press('Escape');
	await expect.poll(() => focused(page)).toBe(id);
	await page.keyboard.press('Escape');
	await expect(card(page, id)).toHaveAttribute('data-status', 'interrupted');
});

test('zoom keys, and the 100% button', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'zoom around me');
	await settled(page);
	await page.getByLabel('Message').blur();
	await page.keyboard.press('1');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
	await page.keyboard.press('+');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1.2);
	await page.keyboard.press('-');
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
	await page.keyboard.press('-');
	await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(0.833, 2);
	await page.getByRole('button', { name: 'Zoom to 100%' }).click();
	await expect.poll(async () => (await viewport(page)).zoom).toBe(1);
	await page.keyboard.press('0'); // fit: one card fits at the maximum zoom
	await expect.poll(async () => (await viewport(page)).zoom).not.toBe(1);
});

test('L tidies, F toggles the focus path, T opens the linear view, ? opens the sheet', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'shortcut target');
	await page.getByLabel('Message').blur();
	await page.keyboard.press('t');
	await expect(page.getByRole('region', { name: 'Linear view' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('region', { name: 'Linear view' })).toHaveCount(0);
	await page.keyboard.press('f');
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await page.keyboard.press('?');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
	await page.keyboard.press('l'); // Tidy puts the only card at the layout origin
	await expect.poll(() => savedNodesText(page)).toContain('"x":0,"y":0');
});

test('typing T, F, 0 and Backspace in the composer only edits the draft', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'typed target');
	await settled(page);
	const before = await viewport(page);
	const field = page.getByLabel('Message');
	await field.click();
	await page.keyboard.type('tf0l');
	await page.keyboard.press('Backspace');
	await expect(field).toHaveValue('tf0');
	await page.getByLabel('Model').focus();
	await page.keyboard.press('t');
	await expect(page.getByRole('region', { name: 'Linear view' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'true');
	expect(await viewport(page)).toEqual(before);
	await expect(card(page, id)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:e2e`
Expected: FAIL — no keyboard handling, no roving focus, and no 100% button.

- [ ] **Step 3: Store**

In `src/lib/canvas/store.svelte.ts`, add these fields after `shortcutsOpen`:

```ts
	/** The card keyboard commands act on — moved by arrows, Home and End, or a click. It is not the target. */
	focusedId = $state<string | null>(null);
	/** Bumped to ask the canvas to show `focusedId` and focus it, even when it is the same id again. */
	focusRequest = $state(0);
	/** Bumped to ask the composer to take the cursor (Enter or B on a card). */
	composerRequest = $state(0);

	/** The one tabbable card: the focused card, else the target, else the first root — never a hidden one. */
	readonly rovingId = $derived.by(() => {
		const { hidden, children } = this.structure;
		for (const id of [this.focusedId, this.target]) if (id && this.graph.nodesById[id] && !hidden.has(id)) return id;
		return children.get(null)?.[0] ?? null;
	});
```

Add these methods after `toggleFocusPath`:

```ts
	/** Moves keyboard focus to a card; the canvas shows it and focuses it. Auto-follow stops: the reader is elsewhere. */
	focusCard(id: string): void {
		this.focusedId = id;
		this.following = null;
		this.focusRequest++;
	}

	/** DOM focus landed on a card (a click or Tab): remember it, nothing more. */
	noteFocus(id: string): void {
		this.focusedId = id;
	}

	/** Enter on a focused card: the composer replies to it from now on, and takes the cursor. */
	bindComposer(id: string): void {
		if (!this.graph.nodesById[id]) return;
		this.target = id;
		this.saver.markView();
		this.composerRequest++;
	}

	/** `B`: what the card's Branch button does, then the cursor goes to the composer. */
	branchFromCard(id: string): void {
		const node = this.graph.nodesById[id];
		if (!node || !canBranchFrom(node)) return;
		this.branch(id);
		this.composerRequest++;
	}

	/** Alt+arrows: moves a card by hand, so Tidy leaves it where it is put. */
	nudge(id: string, dx: number, dy: number): void {
		const node = this.graph.nodesById[id];
		if (!node) return;
		this.commit(moveNode(this.graph, id, { x: node.position.x + dx, y: node.position.y + dy }));
		this.layoutVersion++;
	}

	/** Cmd/Ctrl+Alt+arrows: grows or shrinks a card from its current size. */
	resizeBy(id: string, dw: number, dh: number): void {
		const node = this.graph.nodesById[id];
		if (!node || node.bodyCollapsed) return;
		const current = node.size ?? { width: this.width, height: this.measure().get(id) ?? NODE_HEIGHT_MIN };
		this.resized(id, { width: current.width + dw, height: current.height + dh });
	}
```

In `remove()`, keyboard focus must not stay on a card that is gone. After the `if (this.following && gone.has(this.following)) this.following = null;` line, add:

```ts
		if (this.focusedId && gone.has(this.focusedId)) {
			const parentId = removed[0].parentId;
			if (parentId) this.focusCard(parentId);
			else this.focusedId = null;
		}
```

- [ ] **Step 4: Canvas** — replace `src/lib/components/canvas/Canvas.svelte` with:

```svelte
<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		ControlButton,
		Controls,
		MiniMap,
		SvelteFlow,
		useSvelteFlow,
		type Edge,
		type Node
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import { copy } from '$lib/canvas/copy';
	import { moveFocus } from '$lib/canvas/navigation';
	import { resolveShortcut, type Command } from '$lib/canvas/shortcuts';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { focusOn, panToLowerThird, rectInView, zoomAt, ZOOM_STEP_FACTOR, type Viewport } from '$lib/canvas/viewport';
	import EmptyState from './EmptyState.svelte';
	import NodeCard from './NodeCard.svelte';
	import UndoToast from './UndoToast.svelte';

	let { onpick }: { onpick?: (prompt: string) => void } = $props();
	const store = useCanvas();
	const flow = useSvelteFlow();
	const nodeTypes = { card: NodeCard };
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let container = $state<HTMLDivElement>();
	/** Nodes auto-follow has already framed once. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping read only in rAF, never rendered
	const framed = new Set<string>();

	store.measure = () =>
		new Map(
			store.graph.nodeIds.flatMap((id) => {
				const h = flow.getInternalNode(id)?.measured.height;
				return h ? [[id, h] as const] : [];
			})
		);
	store.visibleCenter = () => {
		const r = container!.getBoundingClientRect();
		return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height * 0.4 });
	};

	// Graph → flow nodes, only when layout or structure changed. Tokens never pass through here.
	$effect(() => {
		void store.layoutVersion;
		untrack(() => {
			const graph = store.graph;
			const { hidden } = store.structure;
			const prev = new Map(nodes.map((n) => [n.id, n]));
			nodes = graph.nodeIds
				.filter((id) => !hidden.has(id))
				.map((id) => {
					const node = graph.nodesById[id];
					const width = node.size?.width;
					const height = node.size && !node.bodyCollapsed ? node.size.height : undefined;
					const p = prev.get(id);
					if (p && p.position.x === node.position.x && p.position.y === node.position.y && p.width === width && p.height === height) return p;
					return { ...(p ?? { id, type: 'card', data: {} }), position: node.position, width, height };
				});
		});
	});

	// Edges: on structure changes, and when the target or the focus path changes — still never per token.
	$effect(() => {
		void store.layoutVersion;
		const path = store.pathIds;
		const dim = store.focusPath && path !== null;
		untrack(() => {
			const graph = store.graph;
			const { hidden } = store.structure;
			edges = graph.nodeIds
				.filter((id) => !hidden.has(id) && graph.nodesById[id].parentId)
				.map((id) => {
					const source = graph.nodesById[id].parentId!;
					const onPath = dim && path!.has(id) && path!.has(source);
					return { id: `e-${id}`, source, target: id, class: !dim ? undefined : onPath ? 'on-path' : 'off-path' };
				});
		});
	});

	// Frame a new node in the lower third once measured, then keep its growing bottom on screen.
	$effect(() => {
		const id = store.following;
		const node = id ? store.graph.nodesById[id] : null;
		if (!id || !node) return;
		void node.response;
		requestAnimationFrame(() => follow(id));
	});

	function follow(id: string) {
		const internal = flow.getInternalNode(id);
		const width = internal?.measured.width;
		const height = internal?.measured.height;
		if (!internal || !width || !height || !container || store.following !== id) return;
		const rect = { ...internal.internals.positionAbsolute, width, height };
		const size = { width: container.clientWidth, height: container.clientHeight };
		const vp = flow.getViewport();
		if (!framed.has(id)) {
			framed.add(id);
			void flow.setViewport(panToLowerThird(vp, rect, size), { duration: 250 });
			return;
		}
		const overflow = (rect.y + rect.height) * vp.zoom + vp.y - (size.height - 24);
		if (overflow > 0) void flow.setViewport({ ...vp, y: vp.y - overflow });
	}

	// Keyboard focus: show the card (off screen it is not even rendered), then give it DOM focus.
	$effect(() => {
		void store.focusRequest;
		const id = untrack(() => store.focusedId);
		if (id) untrack(() => void reveal(id));
	});

	async function reveal(id: string) {
		const node = store.graph.nodesById[id];
		if (!node || !container) return;
		const internal = flow.getInternalNode(id);
		const rect = {
			x: node.position.x,
			y: node.position.y,
			width: internal?.measured.width ?? node.size?.width ?? store.width,
			height: internal?.measured.height ?? node.size?.height ?? 160
		};
		const vp = flow.getViewport();
		const size = { width: container.clientWidth, height: container.clientHeight };
		if (!rectInView(vp, rect, size)) await flow.setViewport(focusOn(rect, size, vp.zoom, 0.5));
		// A card scrolled into view mounts a frame or two later.
		for (let frame = 0; frame < 20; frame++) {
			const el = container.querySelector<HTMLElement>(`article[data-node-id="${id}"]`);
			if (el) {
				el.focus({ preventScroll: true });
				return;
			}
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
	}

	/** Zooms around the focused card's centre, else the canvas centre (the old app's anchor). */
	function zoomTo(zoom: number) {
		const vp = flow.getViewport();
		void flow.setViewport(zoomAt(vp, zoom, zoomAnchor(vp)), { duration: 150 });
	}

	function zoomAnchor(vp: Viewport) {
		const internal = store.focusedId ? flow.getInternalNode(store.focusedId) : undefined;
		if (internal?.measured.width && internal.measured.height) {
			const { x, y } = internal.internals.positionAbsolute;
			return { x: (x + internal.measured.width / 2) * vp.zoom + vp.x, y: (y + internal.measured.height / 2) * vp.zoom + vp.y };
		}
		return { x: container!.clientWidth / 2, y: container!.clientHeight / 2 };
	}

	/** Every canvas shortcut comes through here (spec §8: one window handler). */
	function onKey(event: KeyboardEvent) {
		if (event.defaultPrevented || store.shortcutsOpen) return; // the sheet is modal; its own Esc closes it
		const el = event.target instanceof HTMLElement ? event.target : null;
		const typing = !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
		if (store.transcriptOpen && event.key === 'Escape' && !typing) {
			event.preventDefault();
			store.transcriptOpen = false;
			return;
		}
		const cardId = el?.matches('article[data-node-id]') ? (el.dataset.nodeId ?? null) : null;
		const command = resolveShortcut(event, { typing, onCard: cardId !== null });
		if (!command) return;
		event.preventDefault();
		run(command, cardId);
	}

	function run(command: Command, cardId: string | null) {
		const id = cardId ?? '';
		switch (command.kind) {
			case 'focus': {
				const to = moveFocus(store.graph, cardId ?? store.focusedId ?? store.target, command.move);
				if (to) store.focusCard(to);
				return;
			}
			case 'bind':
				return store.bindComposer(id);
			case 'branch':
				return store.branchFromCard(id);
			case 'regenerate':
				return store.regenerate(id);
			case 'toggleCollapsed':
				return store.toggleCollapsed(id);
			case 'toggleBody':
				return store.toggleBodyCollapsed(id);
			case 'resize':
				return store.resizeBy(id, command.dw, command.dh);
			case 'nudge':
				return store.nudge(id, command.dx, command.dy);
			case 'delete':
				return store.remove(id);
			case 'stop':
				return store.stop(id);
			case 'undo':
				return store.undoRemove();
			case 'zoomIn':
				return zoomTo(flow.getViewport().zoom * ZOOM_STEP_FACTOR);
			case 'zoomOut':
				return zoomTo(flow.getViewport().zoom / ZOOM_STEP_FACTOR);
			case 'zoom100':
				return zoomTo(1);
			case 'fit':
				void flow.fitView({ duration: 250 });
				return;
			case 'tidy':
				return store.tidy();
			case 'focusPath':
				return store.toggleFocusPath();
			case 'transcript':
				store.transcriptOpen = !store.transcriptOpen;
				return;
			case 'shortcuts':
				store.shortcutsOpen = true;
				return;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="flow" bind:this={container}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		initialViewport={store.viewport}
		nodesConnectable={false}
		elementsSelectable={false}
		nodesFocusable={false}
		edgesFocusable={false}
		disableKeyboardA11y
		deleteKey={null}
		zoomOnDoubleClick={false}
		minZoom={0.25}
		maxZoom={2}
		onlyRenderVisibleElements
		onmovestart={(event) => {
			if (event) store.following = null;
		}}
		onmoveend={(_event, viewport) => store.setViewport(viewport)}
		onnodedragstart={() => (store.following = null)}
		onnodedragstop={({ targetNode }) => {
			if (targetNode) store.moved(targetNode.id, targetNode.position);
		}}
	>
		<Background variant={BackgroundVariant.Lines} gap={24} patternColor="var(--cy-paper-edge)" bgColor="var(--cy-paper)" />
		<Controls showLock={false}>
			<ControlButton onclick={() => zoomTo(1)} title={copy('zoom.reset')} aria-label={copy('zoom.reset')}>1:1</ControlButton>
		</Controls>
		<MiniMap pannable zoomable bgColor="var(--cy-paper-deep)" />
	</SvelteFlow>
	{#if store.graph.nodeIds.length === 0}<EmptyState variant="empty" {onpick} />{/if}
	<UndoToast />
</div>

<style>
	.flow {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.flow :global(.svelte-flow__edge.off-path) {
		opacity: 0.35;
		transition: opacity var(--dur-base) var(--ease-out);
	}
	.flow :global(.svelte-flow__edge.on-path .svelte-flow__edge-path) {
		stroke: var(--cy-gold);
		stroke-width: 2;
	}
</style>
```

(If Task 9 adjusted the edge selector to fit 1.7.0, keep its adjustment.)

- [ ] **Step 5: Card, composer, copy**

`src/lib/components/canvas/NodeCard.svelte`: the `article` gains `tabindex={store.rovingId === id ? 0 : -1}`, `aria-current={isTarget ? 'true' : undefined}`, and `onfocusin={() => store.noteFocus(id)}`. Add:

```css
	.card:focus-visible {
		outline: var(--focus-ring-width) solid var(--cy-gold);
		outline-offset: var(--focus-ring-offset);
	}
```

`svelte-check` may warn about a tab stop on a non-interactive `article` (`a11y_no_noninteractive_tabindex`). If it does, put this comment directly above the `article`, naming exactly the rule or rules it reports:

```svelte
<!-- svelte-ignore a11y_no_noninteractive_tabindex -- the cards are a roving-tabindex composite: keyboard focus moves between them (spec §4) -->
```

`src/lib/components/canvas/Composer.svelte`:
- Add, after `draft()`:

```ts
	// Enter or B on a card hands the cursor to the composer.
	$effect(() => {
		if (store.composerRequest > 0) field?.focus();
	});
```

- The textarea's `onkeydown` becomes:

```ts
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						submit();
					} else if (e.key === 'Escape') {
						// Back to the card the composer replies to, so the keyboard carries on from there.
						e.preventDefault();
						field?.blur();
						if (store.target) store.focusCard(store.target);
					}
				}}
```

`src/lib/canvas/copy.ts`: add to `PORT_RULED`:

```ts
  /* Plan 3: the visible 100% control spec §4 lists beside zoom in/out and fit. */
  "zoom.reset": "Zoom to 100%",
```

- [ ] **Step 6: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS. There are 10 new keyboard tests, and every earlier test passes. The interaction spec's 20-run Branch test still holds the target invariant, because clicks and focus moves never change the target.

- [ ] **Step 7: Commit**

```bash
git add src/lib/canvas/store.svelte.ts src/lib/canvas/copy.ts src/lib/components/canvas/Canvas.svelte src/lib/components/canvas/NodeCard.svelte src/lib/components/canvas/Composer.svelte tests/e2e/keyboard.spec.ts
git commit -m "feat(canvas): keyboard — every shortcut on the sheet, through one window handler

Arrows, Home and End walk the tree (an off-screen card is panned into view
and focused); Enter binds the composer, Esc in the composer goes back to its
card; Alt+arrows nudge, Cmd/Ctrl+Alt+arrows resize; Delete and Cmd/Ctrl+Z,
B, R, C, M, zoom keys anchored on the focused card, L, F, T and ?. Nothing
fires while typing. Svelte Flow's own keyboard handling is off.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---
### Task 11: The desktop-only notice, and composer states that say why

**Desktop-only notice.** Spec §2 and §8: below about 900 px wide, the root layout shows a "built for desktop" notice instead of the page. CSS does the switching, so there is no flash and no hydration mismatch, and it covers every route. The old app had no such notice; the wording is new and goes under `PORT_RULED`.

**Composer fixes.** Three small composer fixes from the Plan 2 follow-ups:
- A finished reply with no text no longer says it will finish. The composer and the Branch tooltip use `branch.disabled` only while the card is still streaming.
- When the composer is blocked and there is a draft, the reason shows under the draft. Until now it only lived in the placeholder, which the draft hides.
- The limit test asserts that Send is disabled, and the starter test asserts that no card was created.

**Files:**
- Modify: `src/routes/+layout.svelte`, `src/lib/canvas/store.svelte.ts`, `src/lib/components/canvas/NodeCard.svelte`, `src/lib/components/canvas/Composer.svelte`, `src/lib/canvas/copy.ts`
- Create: `src/lib/components/DesktopOnlyNotice.svelte`, `tests/e2e/layout.spec.ts`
- Modify: `tests/support/fake-anthropic.ts` (`[empty]` marker), `tests/e2e/canvas.spec.ts`, `tests/e2e/banners.spec.ts`

**Interfaces:**
- **Consumes:**
  - `sendBlockedReason` and `streamBlockedReason` from Task 7.
  - The base tokens in `src/lib/styles/tokens.css`: `--background`, `--foreground`, `--muted`, `--text-2xl`, `--text-base`, `--space-*`, `--font-sans`.
- **Produces:**
  - Copy keys `desktop.title` and `desktop.body`.
  - The fake marker `[empty]`: a reply that completes with no text.
  - DOM: `.composer .note` shows the blocked reason while there is a draft.

- [ ] **Step 1: Write the failing tests**

`tests/e2e/layout.spec.ts`:

```ts
import { expect, test } from './fixtures';

test('below 900 pixels wide the app says it is built for desktop', async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 900 });
	await page.goto('/sign-in');
	const notice = page.getByRole('heading', { name: 'node-canvas is built for desktop' });
	await expect(notice).toBeVisible();
	await expect(page.getByLabel('Email')).toBeHidden();
	await page.setViewportSize({ width: 1200, height: 900 });
	await expect(notice).toBeHidden();
	await expect(page.getByLabel('Email')).toBeVisible();
});
```

Append to `tests/e2e/canvas.spec.ts`:

```ts
test('a reply that finished empty says so in the composer instead of waiting forever', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[empty] say nothing');
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'complete');
	await expect(page.getByLabel('Message')).toHaveAttribute(
		'placeholder',
		"This reply didn't finish. Branch from another card, or start a new conversation."
	);
});
```

In `tests/e2e/banners.spec.ts`:
- **Offline test.** After the "Send is disabled" assertion, add `await expect(page.locator('.composer .note')).toHaveText('Offline');`.
- **Hourly-limit test.** At the end, add:

```ts
	await page.getByLabel('Message').fill('again');
	await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
	await expect(page.locator('.composer .note')).toHaveText('Hourly limit reached');
```

- **Starter test.** At the end, add `await expect(page.locator('article[data-node-id]')).toHaveCount(0);`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:e2e`
Expected: FAIL. There is no notice and no `[empty]` marker. The empty reply shows "Available when the reply finishes.", and there is no note under the draft.

- [ ] **Step 3: Implement**

In `tests/support/fake-anthropic.ts`'s `plan()`, after the `[markdown]` block, add `if (prompt.includes('[empty]')) text = '';`. The reply then completes with no text deltas.

In `src/lib/canvas/copy.ts`, add to `PORT_RULED`:

```ts
  /* Plan 3: spec §2 / §8's notice below ~900 px. The old app had none; this is new wording. */
  "desktop.title": "node-canvas is built for desktop",
  "desktop.body":
    "Open it in a browser window at least 900 pixels wide. Your canvas is saved and waiting there.",
```

Create `src/lib/components/DesktopOnlyNotice.svelte`:

```svelte
<!-- Spec §2: desktop only. Shown instead of the page below 900 px (the layout hides the page). -->
<script lang="ts">
	import { copy } from '$lib/canvas/copy';
</script>

<div class="desktop-only" role="note">
	<h1>{copy('desktop.title')}</h1>
	<p>{copy('desktop.body')}</p>
</div>

<style>
	.desktop-only {
		display: none;
	}
	@media (max-width: 899px) {
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
	}
	h1 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	p {
		margin: 0;
		font-size: var(--text-base);
		color: var(--muted);
	}
</style>
```

`src/routes/+layout.svelte` becomes:

```svelte
<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import DesktopOnlyNotice from '$lib/components/DesktopOnlyNotice.svelte';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="page">{@render children()}</div>
<DesktopOnlyNotice />

<style>
	/* Spec §2: desktop only. CSS switches, so a narrow window never flashes the page first. */
	@media (max-width: 899px) {
		.page {
			display: none;
		}
	}
</style>
```

In `src/lib/canvas/store.svelte.ts`, `sendBlockedReason`'s last check becomes:

```ts
		// Only a reply still on its way will finish; one that stopped, failed or came back empty will not.
		if (t && !canBranchFrom(t)) return copy(t.status === 'streaming' ? 'branch.disabled' : 'branch.failed');
```

In `src/lib/components/canvas/NodeCard.svelte`, the Branch button's `title` uses the same rule: `copy(node.status === 'streaming' ? 'branch.disabled' : 'branch.failed')`.

In `src/lib/components/canvas/Composer.svelte`, add this after the `tooLong` note:

```svelte
	{#if blocked && text.trim()}<p class="note" role="status">{blocked}</p>{/if}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS. There is 1 new layout test and 1 new canvas test, and the banner tests gain their 4 assertions.

- [ ] **Step 5: Commit**

```bash
git add src/routes/+layout.svelte src/lib/components/DesktopOnlyNotice.svelte src/lib/canvas/store.svelte.ts src/lib/canvas/copy.ts src/lib/components/canvas/NodeCard.svelte src/lib/components/canvas/Composer.svelte tests/support/fake-anthropic.ts tests/e2e/layout.spec.ts tests/e2e/canvas.spec.ts tests/e2e/banners.spec.ts
git commit -m "feat: a desktop-only notice below 900 px, and a composer that says why it waits

Below 900 px wide the layout shows a built-for-desktop notice instead of the
page (CSS, so nothing flashes). A reply that ended without text no longer
promises to finish, and a blocked composer shows its reason next to the draft.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 12: Performance budget, and the documents

Plan 3 adds dimming, focus and new card chrome. This task re-runs the performance budget, spec §1.4: p95 frame time ≤ 20 ms at 4× CPU, with 50 nodes and 3 streams. Then it brings the documents up to date with what Plan 3 changed:
- `AGENTS.md`'s canvas conventions;
- the README;
- the spec's §6 and §8 (the paged load, the store);
- the Plan 2 follow-ups note.

**Files:**
- Modify: `AGENTS.md`, `README.md`, `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`, `docs/superpowers/notes/2026-10-06-plan-2-followups.md`

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: documents only.

- [ ] **Step 1: Run the performance budget**

Run: `pnpm test:perf`, twice.
Expected: PASS both times, with p95 ≤ 20 ms. Record both sample lines in the report. If p95 goes over 20 ms, report DONE_WITH_CONCERNS with the samples and stop. Do not change the threshold or the workload.

- [ ] **Step 2: `AGENTS.md`**

In the hand-written part, below `# node-canvas — notes for agents`, add this section after "## Server code":

```markdown
## Canvas conventions

- Canvas state lives in `src/lib/canvas/store.svelte.ts`; the deciding logic lives in the
  framework-free modules beside it (`graph.ts`, `navigation.ts`, `shortcuts.ts`, `saver.ts`, …),
  each with `node:test` tests. Put new logic there, not in components.
- The composer target changes only through Branch (button or `B`), sending (Continue and
  Regenerate included), New conversation, Enter on a focused card, and deleting the target or an
  ancestor of it. Nothing else assigns `store.target`.
- Every canvas shortcut goes through `resolveShortcut` (`src/lib/canvas/shortcuts.ts`) and the one
  `svelte:window` handler in `Canvas.svelte`. A new key gets its row in `SHORTCUT_ROWS` too, so
  the `?` sheet never lists a key that does nothing, or misses one that works.
- The canvas loads its nodes from `GET /api/nodes`, page by page; the page data carries only the
  view. Never put node text back into a `load`: Vercel caps a response at 4.5 MB.
```

In "## Checks before handing work over", after the paragraph about `signIn()`, add one sentence: "`signIn()` talks to a loopback seed server that only the local rig starts, so specs that use it cannot run against `E2E_BASE_URL`."

- [ ] **Step 3: `README.md`**

Change the line `Desktop only. MIT licensed.` to `Desktop only (900 px and wider). On the canvas, press \`?\` for every keyboard shortcut. MIT licensed.`

- [ ] **Step 4: The spec**

In `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`, §6:

Replace the body of "### Canvas load" with:

```markdown
`/canvas/+page.server.ts` `load` returns `{ view, hasKey, models, defaultModelId, email }` for
the signed-in user. The nodes are not in the page data: the page fetches them from
`GET /api/nodes` before it builds the canvas — pages in creation order of at most 3 MiB of text
(or one larger node alone) — so no canvas is too big to open under Vercel's 4.5 MB response cap
(Plan 3). The page component itself renders client-side only (`ssr = false`).
```

In "### JSON routes":
- Change "All three require a session, `assertSameOrigin` and `Content-Type: application/json`." to "The write routes require a session, `assertSameOrigin` and `Content-Type: application/json`; the read route requires a session."
- Add this bullet first:

```markdown
- **`GET /api/nodes[?after=<cursor>]`** — one page of the canvas load: `{ nodes: NodeWire[], next: string | null }`, in `(created_at, id)` order. The cursor is the last node's exact `created_at` and id.
```

In §8, at the end of the `canvas.svelte.ts` bullet group, add:

```markdown
  - Plan 3 also gave it: `focusedId` (keyboard focus, never the target), `focusPath` (on by default, `F`), `structure` (children and the hidden set, rebuilt per `layoutVersion`), `pathIds`, `transcriptOpen`, `shortcutsOpen`; and `continueReply`, `regenerate`, `bindComposer`, `branchFromCard`, `focusCard`, `resizeBy`.
```

- [ ] **Step 5: The follow-ups note**

Replace `docs/superpowers/notes/2026-10-06-plan-2-followups.md` with:

```markdown
# Plan 2 follow-ups

Open review findings from Plan 2's reviews (per task, final, and re-reviews), brought up to date
after Plan 3. Plan 3's own review findings are added when it finishes.

## Resolved in Plan 3

- **Cutover blockers.** The canvas load is paged (`GET /api/nodes`, at most 3 MiB a page);
  markdown parses only a streaming reply's unfinished tail; the relay sends a ping when the model
  starts, so a long thinking phase no longer reads as "Timed out".
- **Saver.** Refused nodes take turns under the singles cap; the view waits for its target to be
  saved; only one unload save runs at a time; deletes go through the saver, after its saves.
- **Canvas.** A visible 100% zoom control; a reply that ended without text no longer promises to
  finish; a blocked composer shows its reason next to the draft; numbered lists keep their
  numbers, a lead-in line splits from its list, nested markers are stripped, long tokens wrap;
  keyboard navigation walks the graph, so Svelte Flow's DOM order does not matter.
- **Tests.** The relay's mid-stream error frame and its 2 MB cap; Send disabled at the limit; a
  starter prompt creates no card; a click on a card leaves the composer target alone; the canvas
  load refuses a signed-out reader.

## Still open

### Before cutover (Plan 4)

- Copy: the offline banner says "new messages will fail" but sending is blocked; the limit
  banner's reset time does not count down; `node.action.openSettings` still says "Open settings";
  `unauthenticated` and `unsupported_model` show the generic error line, with no sign-in hint;
  stale comments in `chat-limits.ts` and `copy.ts` (00:00 UTC).
- Styles: some literals (sizes, shadow, weight) should use tokens.

### Saver

- `dispose()` saves before the stopped streams settle (the next load repairs it).
- Last-write-wins has no guard. A browser-clock guard was tried and reverted; use a server-side
  revision counter if the keepalive-vs-in-flight race ever matters.
- `flush()` returns the in-flight promise when a caller wants everything saved now.
- Rejected ids from `PUT /api/nodes` are dropped silently.

### Tests worth adding

- `/api/chat` abort propagation.
- A pre-stream `ApiCallError` ends as `data-status="error"`.
- Nodes: a mixed owned-plus-foreign batch; a foreign parent at the route level.

### Small hardening

- `parseChatBody`: require the last message to be from the user; reject consecutive same-role messages.
- `parseSaveBody`: reject `parentId === id` and duplicate ids (duplicates give a 500 today; the saver never sends them).
- `nodes.ts`: any 23503 is reported as "parent not on this canvas".
```

- [ ] **Step 6: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e`
Expected: PASS. Nothing executable changed in this task; the run confirms the branch as a whole.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md README.md docs/superpowers/specs/2026-09-25-sveltekit-port-design.md docs/superpowers/notes/2026-10-06-plan-2-followups.md
git commit -m "docs: canvas conventions, the paged load in the spec, and what Plan 3 resolved

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

### Spec coverage, Plan 3's share

**§4 canvas items:**

| Item | Where |
|---|---|
| Retry and continue on error or interruption | Task 7 |
| Delete a card and its subtree, with Undo and Cmd/Ctrl+Z | Tasks 6, 7 and 10 |
| Zoom in/out, fit and 100% | Task 10, keys plus the visible 1:1 control |
| Transcript view (T) | Tasks 9 and 10 |
| Keyboard navigation: arrows, Home/End, Enter, Alt+arrows, the `?` sheet and every one of its 21 rows | Tasks 4, 5, 9 and 10 |
| Card size controls: handle, Cmd/Ctrl+Alt+arrows, body collapse, subtree collapse with a hidden-count chip | Tasks 8 and 10 |
| Focus-path dimming | Tasks 9 and 10 |

**Other sections:**
- §2 and §8, the desktop-only notice → Task 11.
- §6, the canvas load and JSON routes → Task 1, with the spec amended in Task 12.
- §8:
  - store fields and actions → Tasks 7–10;
  - "one `svelte:window` keydown handler for all shortcuts" → Task 10;
  - `NodeResizer` → Task 8, which uses `NodeResizeControl` (one bottom-right handle, as the old app had);
  - `TranscriptView` (named `LinearView`, the approved copy), `ShortcutsSheet`, `UndoToast` and `DesktopOnlyNotice` → Tasks 7, 9 and 11.
- §9 browser tests:
  - delete + undo → Task 7;
  - transcript → Task 9;
  - keyboard navigation → Task 10;
  - resize and collapse → Task 8;
  - focus-path dimming → Task 9;
  - the performance budget, re-run → Task 12.

**Plan 2 cutover blockers:** I1 → Task 1, I2 → Task 3, M4 → Task 2.

**Left for Plan 4:** the landing page, the copy pass (listed in the follow-ups note) and cutover.

### Deliberate deviations, for review

1. **The canvas load is paged** through `GET /api/nodes` rather than returned by the page `load` as §6 says. This is the I1 fix, and Task 12 amends the spec.
2. **The focus path is on by default, with a toggle** (`F` and a top-bar button). This is the old app's toggle; the spec only names the dimming. Cards dim, as the spec says; the old app dimmed only edges.
3. **The transcript anchors on the composer target only.** The old app used "selected ?? focused" and showed only the first root's exchange when nothing was selected. With no target, the panel says so.
4. **Retry is offered only while the card has no replies.** Retrying would clear the text its replies were answered against. Regenerate covers that case.
5. **Continue and Regenerate count as sending** in the composer-target invariant: they move the composer to the new card.
6. **Tidy lays out only the drawn cards.** Hidden cards keep their place, and expanding lays their subtree out again.
7. **Body collapse does not reflow the card's replies.** This matches the old app; Tidy fixes any overlap.
8. **The desktop-only notice is CSS-switched** and covers every route, including sign-in. The page stays mounted, but hidden.
9. **Svelte Flow's own keyboard handling is off** (`nodesFocusable`, `edgesFocusable`, `disableKeyboardA11y`), so its arrow keys cannot move cards behind ours.

### Old-app defects deliberately not carried over

- A dangling selection after deleting an ancestor of the target crashed the old app. Here the target goes to `null`, and Undo restores it.
- Deleting a card left its descendants' streams running, and Undo restored a node as "streaming" with no request behind it. Here the streams stop, and Undo restores the node as "Stopped".
- A body-collapsed card stayed at least 120 px tall. Here it is one line.
- Delete and Backspace acted on the roving card even when focus was on a button elsewhere. Here card commands need DOM focus on the card itself.
- Cmd/Ctrl+R fired Regenerate. Here modified letters are left to the browser.

### Names used across tasks

Each is defined once, in the task named:
- **Task 1:** `PAGE_BYTES`, `Cursor`, `encodeCursor`, `decodeCursor`, `takePage`, `loadNodesPage`, `loadView`, `loadAllNodes`, `NodesPage`, `MAX_PAGES`, `savedNodesText`, and the other e2e helpers.
- **Task 2:** `{ type: 'ping' }`.
- **Task 3:** `MarkdownStream`.
- **Task 4:** `CONTINUE_PROMPT`, `graphStructure`, `GraphStructure`, `hiddenIds`, `visibleGraph`, `adoptPositions`, `expandPath`, `extractBranch`, `restoreBranch`, `canRetry`, `canContinue`, `canRegenerate`, `moveFocus`, `FocusMove`.
- **Task 5:** `Command`, `KeyInput`, `KeyContext`, `resolveShortcut`, `SHORTCUT_ROWS`, `NUDGE_PX`, `NUDGE_FAR_PX`, `RESIZE_PX`, `RESIZE_FAR_PX`.
- **Task 6:** `markDeleted`, `cancelDeletion`, `SaverDeps.remove`.
- **Task 7:** `UNDO_MS`, `UndoState`, `undo`, `streamBlockedReason`, `retry`, `continueReply`, `regenerate`, `remove`, `undoRemove`, `createAndStream`.
- **Task 8:** `structure`, `childCount`, `hiddenBelow`, `toggleCollapsed`, `toggleBodyCollapsed`, `resized`.
- **Task 9:** `focusPath`, `pathIds`, `dimmed`, `toggleFocusPath`, `transcriptOpen`, `shortcutsOpen`, `transcriptText`.
- **Task 10:** `focusedId`, `focusRequest`, `composerRequest`, `rovingId`, `focusCard`, `noteFocus`, `bindComposer`, `branchFromCard`, `nudge`, `resizeBy`.

### Deploy

Plan 3 needs no migration, and production keeps `0001`. Merging `main` deploys to node-canvas-theta.vercel.app.
