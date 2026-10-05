# node-canvas Plan 2 — Canvas core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user with a connected key can open `/canvas`, send a prompt, watch the reply (and its thinking summary) stream into a card on a Svelte Flow canvas, branch from any finished card, drag and tidy cards, and reload to find everything exactly as they left it — saved one node at a time.

**Architecture:** Shared, framework-free TypeScript (`src/lib/shared/**`, `src/lib/canvas/**`) carries the graph model, layout, wire formats, the stream client, a stream queue and a saver — all unit-tested with `node:test`. A Svelte 5 store class wires them to Svelte Flow components. The server adds `PUT /api/nodes`, `DELETE /api/nodes/:id` and the stateless `POST /api/chat` relay; the canvas page's server load returns the user's nodes. Tests never call the real Anthropic API: a fake Messages server streams realistic SSE, and a test-only seed server creates users, keys and sessions directly.

**Tech Stack:** As Plan 1, plus `@xyflow/svelte` 1.7.0 (pinned). Anthropic: `@anthropic-ai/sdk` 0.128.0, `client.beta.messages.stream`.

**Spec:** `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md` (§§2, 4, 5, 6, 8, 9). This is plan 2 of 4: (1) foundation & accounts — done; (2) canvas core — this; (3) canvas features (delete + undo, retry/continue, keyboard navigation and shortcuts, resize and collapse, focus path, transcript view, desktop-only notice); (4) landing page, copy pass & cutover.

## Global Constraints

- Repo: `/Users/nicholas/Workspace/node-canvas`. Work on a feature branch (`main` is protected and requires the `verify` check); open a PR per the execution handoff.
- Carried code comes from the old repo `/Users/nicholas/Workspace/node-canvas-chat` at commit `c215512`, via the `carry` helper below — never from a working tree.
- Desktop only. No touch gestures, no mobile layouts, no `pointer: coarse` code.
- Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`); event attributes (`onclick`); no `svelte/store`; no Tailwind; styles in component `<style>` blocks using tokens.
- `src/lib/shared/**`, `src/lib/canvas/**` (except `*.svelte.ts`) and `src/lib/server/**`: relative imports only, no `$app/*` / `$env/*`, so `node:test` loads them.
- Unit tests `*.test.ts` (`pnpm test`); database tests `*.dbtest.ts` (`pnpm test:db`); browser tests `tests/e2e/*.spec.ts` (`pnpm test:e2e`); performance `tests/e2e/perf.spec.ts` (`pnpm test:perf`, not part of CI).
- Models: `claude-opus-5-5` (default, adaptive thinking with `display: "summarized"`, effort `medium`, server-side fallbacks), `claude-sonnet-5-5` (same), `claude-haiku-4-5` (no `thinking`, no effort, no fallbacks). Exact IDs, no date suffixes. `max_tokens: 64000`, streaming only.
- Server-side fallbacks: `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` on models that enable them.
- Limits: chat 60 per user per hour; nodeWrite 120 per user per minute; `/api/chat` body ≤ 2 MB; `/api/nodes` body ≤ 4 MB and ≤ 200 nodes; prompt ≤ 100,000 chars; response and thinking ≤ 400,000 chars each.
- Stream queue: at most 3 concurrent streams, FIFO beyond that, 60 s first-token watchdog.
- Saver: flush every 1.5 s, on `visibilitychange → hidden`, and on `pagehide` (keepalive request ≤ 60 KB); batches ≤ 200 nodes / ≤ 4 MB, parents first; a non-network failure shows the save-failed banner and keeps the ids dirty; offline waits for `online`.
- Composer target invariant: only Branch, send, "New conversation" (and Plan 3's Enter-on-focused-card / delete) change it. A pane or card click never does.
- Provider key: only in `provider_keys.ciphertext`; decrypted only in `/api/chat` after the session check; never sent to the browser.
- Never log keys, tokens, passwords, prompts, responses, emails or error messages — route, error name and code only.
- Every commit ends with `Co-Authored-By: <your model> <noreply@anthropic.com>`. Conventional prefixes. Commits touching auth, key storage or the provider route say where the key lives, what encrypts it, and what a database read yields.
- Before handing over any task: `pnpm check && pnpm lint && pnpm test`, plus `pnpm test:db` / `pnpm test:e2e` where the task touches them. `pnpm check` must report 0 errors and 0 warnings.

### Carrying a file from the old repo

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
```

## Review Focus

The five conditions the spec implies that a person will hit, and the test that pins each (in the owning task):

1. **Reloading or closing the tab while a reply streams** — the card comes back as "Stopped" with the partial text kept, and that settled status is saved back. → Task 9, test "reload mid-stream keeps the partial reply as stopped".
2. **A reply containing HTML-looking text** (`<img onerror=…>`, `<script>`) — shown as text, never interpreted. → Task 4 unit test "treats HTML as text"; Task 9 e2e "markdown renders and HTML stays text".
3. **A save batch where a child arrives before its parent, or references a parent that was just deleted** — the first saves fine; the second is refused without writing anything, and the saver drops vanished nodes instead of retrying them forever. → Task 7 dbtests "saves a child before its parent in one batch (deferred FK)" and "rejects the whole batch when a parent does not exist, writing nothing"; Task 8 saver test "drops nodes that no longer exist".
4. **Hitting the hourly chat limit** — the card says so, a banner says when it resets, and the composer stays disabled until then. → Task 10 e2e "the hourly limit blocks sending and says when it resets".
5. **A reply far past the old 256 KB ceiling (~350 KB)** — streams, saves and reloads intact. → Task 7 dbtest "saves a 390k-character response"; Task 8 saver test "splits by bytes when nodes are large"; Task 9 e2e "a 350 KB reply survives a reload".

## File structure (added or changed by Plan 2)

```
db/migrations/0002_nodes_parent_fk_deferrable.sql
src/lib/shared/
  error-codes.ts          ERROR_CODES, ErrorCode, ApiErrorBody, NodeErrorCode (shared)
  chat-types.ts           ChatRole, ChatMessage, ChatStreamEvent
  chat-limits.ts (+test)  carried caps
  models.ts (+test)       MODELS, DEFAULT_MODEL_ID, findModel
src/lib/canvas/
  graph.ts (+test)        carried graph model (+ model field, uuid ids, shared limits)
  layout.ts (+test)       carried
  viewport.ts             carried
  node-wire.ts (+test)    NodeWire/ViewWire ⇄ ConversationNode
  api-client.ts           carried fetch wrapper (+ network code, keepalive)
  stream.ts (+test)       carried SSE client (no provider field)
  errors.ts (+test)       presentError by code, toNodeError
  copy.ts (+test)         carried strings (limit wording fixed, new keys)
  format.ts (+test)       formatDuration
  markdown.ts (+test)     parseMarkdown → blocks (XSS-inert)
  streams.ts (+test)      StreamQueue: concurrency, FIFO, watchdog, stop
  saver.ts (+test)        Saver: dirty set, batching, keepalive, failure state
  store.svelte.ts         CanvasStore (runes) — wires everything
src/lib/server/
  api-error.ts            imports codes from shared/error-codes
  anthropic.ts (+test)    + streamChat (beta stream, fallbacks)
  chat.ts (+test)         parseChatBody / parseMessages
  nodes.ts (+test, +dbtest) parseSaveBody, saveNodes, deleteNode, loadCanvas
src/lib/components/canvas/
  CanvasApp.svelte  Canvas.svelte  NodeCard.svelte  Composer.svelte
  TopBar.svelte  Markdown.svelte  EmptyState.svelte  Banner.svelte
src/routes/
  api/chat/+server.ts  api/nodes/+server.ts  api/nodes/[id]/+server.ts
  canvas/+page.server.ts  canvas/+page.ts  canvas/+page.svelte
tests/support/
  fake-anthropic.ts       + POST /v1/messages streaming, /__requests, /__reset
  seed-server.ts          test-only: seed users/keys/sessions/nodes/limits
  e2e-server.ts           + seed server, shared vault key
tests/e2e/
  fixtures.ts  chat-api.spec.ts  nodes-api.spec.ts  canvas.spec.ts
  interaction.spec.ts  banners.spec.ts  perf.spec.ts
```

---

### Task 1: Shared contracts — error codes, chat types, limits, models

**Files:**
- Create: `src/lib/shared/error-codes.ts`, `src/lib/shared/chat-types.ts`, `src/lib/shared/models.ts`, `src/lib/shared/models.test.ts`
- Create (carried): `src/lib/shared/chat-limits.ts`
- Modify: `src/lib/server/api-error.ts`
- Test: `src/lib/shared/models.test.ts`, existing `src/lib/server/api-error.test.ts`

**Interfaces:**
- Produces:
  - `ERROR_CODES` (adds `'model_declined'`), `type ErrorCode`, `type ClientErrorCode = 'network' | 'timeout'`, `type NodeErrorCode = ErrorCode | ClientErrorCode`, `type ApiErrorBody`
  - `type ChatRole`, `type ChatMessage = { role: ChatRole; content: string }`, `type ChatStreamEvent`
  - `MAX_MESSAGES = 100`, `MAX_MESSAGE_CHARS = 100_000`, `MAX_TOTAL_CHARS = 400_000`, `MAX_SYSTEM_CHARS = 10_000`, `MAX_BODY_BYTES = 2 MiB`
  - `type ModelSpec = { id; label; description; thinking: 'adaptive' | 'none'; effort: 'medium' | null; fallbacks: boolean }`, `MODELS`, `DEFAULT_MODEL_ID = 'claude-opus-5-5'`, `findModel(id: unknown): ModelSpec | null`
  - `api-error.ts` keeps exporting `ERROR_CODES`, `ErrorCode`, `ApiErrorBody` (re-exported) and gains `model_declined → 422`.

- [ ] **Step 1: Write the failing test** — `src/lib/shared/models.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './models'`.

- [ ] **Step 3: Implement**

`src/lib/shared/error-codes.ts`:

```ts
/**
 * The error vocabulary shared by the server envelope, SSE error frames and
 * the browser. `code` is the stable contract; messages are for people.
 */
export const ERROR_CODES = [
	'invalid_request',
	'payload_too_large',
	'unauthenticated',
	'not_found',
	'email_taken',
	'invalid_credentials',
	'invalid_api_key',
	'provider_unavailable',
	'model_declined',
	'unsupported_model',
	'no_key_configured',
	'rate_limited',
	'csrf_failed',
	'not_configured',
	'internal_error'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Produced only in the browser: the request never reached us, or no first token arrived. */
export type ClientErrorCode = 'network' | 'timeout';

/** Anything a card can show as its failure. */
export type NodeErrorCode = ErrorCode | ClientErrorCode;

export type ApiErrorBody = {
	error: { code: ErrorCode; message: string; fields?: Record<string, string> };
};
```

`src/lib/shared/chat-types.ts`:

```ts
import type { ErrorCode } from './error-codes';

/** Transport-neutral shapes between the provider and the browser. Nothing provider-shaped crosses. */
export type ChatRole = 'user' | 'assistant';

export type ChatMessage = { role: ChatRole; content: string };

export type ChatStreamEvent =
	/** An increment of the visible answer. */
	| { type: 'text'; text: string }
	/** An increment of the summarized reasoning. Never the answer. */
	| { type: 'thinking'; text: string }
	/** Terminal success. */
	| { type: 'done'; stopReason: string; usage: { inputTokens: number; outputTokens: number } }
	/** Terminal failure, mid-stream. Same codes as the JSON API. */
	| { type: 'error'; code: ErrorCode; message: string };
```

`src/lib/shared/models.ts`:

```ts
/**
 * The server-side model allowlist, also sent to the canvas for its selector.
 * Exact model ids — never date-suffixed. Refreshed when Anthropic ships models.
 */
export type ModelSpec = {
	id: string;
	label: string;
	description: string;
	/** 'adaptive' sends thinking { type: 'adaptive', display: 'summarized' }; 'none' omits it. */
	thinking: 'adaptive' | 'none';
	/** output_config.effort, or null to omit (Haiku 4.5 rejects effort). */
	effort: 'medium' | null;
	/** Server-side refusal fallbacks (fallbacks: "default"). */
	fallbacks: boolean;
};

export const MODELS: readonly ModelSpec[] = [
	{
		id: 'claude-opus-5-5',
		label: 'Claude Opus 5.5',
		description: 'Most capable. The default.',
		thinking: 'adaptive',
		effort: 'medium',
		fallbacks: true
	},
	{
		id: 'claude-sonnet-5-5',
		label: 'Claude Sonnet 5.5',
		description: 'Faster and cheaper, still strong.',
		thinking: 'adaptive',
		effort: 'medium',
		fallbacks: true
	},
	{
		id: 'claude-haiku-4-5',
		label: 'Claude Haiku 4.5',
		description: 'Fastest. Good for short branches.',
		thinking: 'none',
		effort: null,
		fallbacks: false
	}
];

export const DEFAULT_MODEL_ID = 'claude-opus-5-5';

export function findModel(id: unknown): ModelSpec | null {
	return typeof id === 'string' ? (MODELS.find((m) => m.id === id) ?? null) : null;
}
```

Carry the limits (unchanged apart from nothing — it has no imports):

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/lib/chat-limits.ts src/lib/shared/chat-limits.ts
```

`src/lib/server/api-error.ts`: delete its own `ERROR_CODES` array, `ErrorCode` type and `ApiErrorBody` type, and put this at the top, after the `@sveltejs/kit` import:

```ts
import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from '../shared/error-codes';

export { ERROR_CODES };
export type { ApiErrorBody, ErrorCode };
```

and add `model_declined: 422,` to `STATUS_BY_CODE` (after `provider_unavailable: 502,`).

- [ ] **Step 4: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: PASS — models 4 tests; all existing suites still green (api-error, vault, etc.).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shared src/lib/server/api-error.ts
git commit -m "feat(shared): error codes, chat types, limits and the model allowlist shared by server and canvas

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Carry the graph model, layout and viewport

**Files:**
- Create (carried, edited): `src/lib/canvas/graph.ts`, `src/lib/canvas/graph.test.ts`, `src/lib/canvas/layout.ts`, `src/lib/canvas/layout.test.ts`, `src/lib/canvas/viewport.ts`
- Create: `src/lib/canvas/node-wire.ts`, `src/lib/canvas/node-wire.test.ts`
- Modify: `package.json` (add `@xyflow/svelte`)

**Interfaces:**
- Consumes: `ChatMessage` (Task 1), `NodeErrorCode` (Task 1), `MAX_MESSAGES`, `MAX_MESSAGE_CHARS`, `MAX_TOTAL_CHARS` (Task 1).
- Produces (graph, unchanged API from the old repo plus): `ConversationNode.model: string | null`; `AddNodeInput.model?: string | null`; `NodeError.code: NodeErrorCode`; `newNodeId()` always returns a UUID. Everything else as carried: `createGraph`, `addNode`, `removeBranch`, `moveNode`, `placeNode`, `setCollapsed`, `setBodyCollapsed`, `resizeNode`, `resetAllToAuto`, `startStreaming`, `appendText`, `appendThinking`, `completeNode`, `failNode`, `interruptNode`, `settleOrphanedStreams`, `toMessages`, `checkBranchSize`, `rootIds`, `childIds`, `pathToRoot`, `descendantIds`, `canBranchFrom`, `type ConversationGraph`, `type ConversationNode`, `type NodeStatus`, `type NodeError`, `type Point`, `type Size`.
- Produces (layout/viewport as carried): `autoPlaceOnCreate`, `centeredRootPosition`, `reflowChildrenOnCreate`, `tidyLayout`, `graphBounds`, `NODE_WIDTH_DESKTOP = 460`, `type NodeHeights`; `panToLowerThird`, `fitViewport`, `type Viewport`.
- Produces (node-wire):
  - `type NodeWire = { id; parentId: string | null; prompt; response; thinking; status: NodeStatus; error: NodeError | null; usage: { inputTokens: number; outputTokens: number } | null; model: string | null; x: number; y: number; positionMode: 'auto' | 'manual'; width: number | null; height: number | null; collapsed: boolean; bodyCollapsed: boolean; createdAt: number; updatedAt: number }`
  - `type ViewWire = { viewport: { x: number; y: number; zoom: number }; targetNodeId: string | null }`
  - `toWire(node: ConversationNode): NodeWire`, `fromWire(wires: readonly NodeWire[]): ConversationGraph` (orders by `createdAt`, then `id`)

- [ ] **Step 1: Carry the tests and fix their imports**

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/lib/conversation/graph.test.ts src/lib/canvas/graph.test.ts
carry src/lib/canvas/layout.test.ts      src/lib/canvas/layout.test.ts
sed -i '' 's#from "@/lib/conversation/graph";#from "./graph";#' src/lib/canvas/layout.test.ts
pnpm add @xyflow/svelte@1.7.0
```

Write `src/lib/canvas/node-wire.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addNode, appendText, completeNode, createGraph, newNodeId } from './graph';
import { fromWire, toWire } from './node-wire';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('node ids', () => {
	it('are always UUIDs (the nodes table keys on uuid)', () => {
		for (let i = 0; i < 20; i++) assert.match(newNodeId(), UUID);
	});
});

describe('node wire format', () => {
	it('round-trips a node, including its model', () => {
		const a = addNode(createGraph(), { prompt: 'hi', position: { x: 10, y: 20 }, model: 'claude-opus-5-5', now: 1000 });
		const done = completeNode(appendText(a.graph, a.node.id, 'hello'), a.node.id, { inputTokens: 1, outputTokens: 2 }, 2000);
		const wire = toWire(done.nodesById[a.node.id]);
		assert.equal(wire.model, 'claude-opus-5-5');
		assert.equal(wire.x, 10);
		assert.equal(wire.response, 'hello');
		const back = fromWire([wire]);
		assert.deepEqual(back.nodeIds, [a.node.id]);
		assert.deepEqual(back.nodesById[a.node.id], done.nodesById[a.node.id]);
	});

	it('orders nodes by creation time so parents precede children', () => {
		const root = addNode(createGraph(), { prompt: 'r', position: { x: 0, y: 0 }, now: 1 });
		const withChild = completeNode(appendText(root.graph, root.node.id, 'a'), root.node.id, null, 2);
		const child = addNode(withChild, { parentId: root.node.id, prompt: 'c', position: { x: 0, y: 0 }, now: 3 });
		const wires = child.graph.nodeIds.map((id) => toWire(child.graph.nodesById[id])).reverse();
		assert.deepEqual(fromWire(wires).nodeIds, [root.node.id, child.node.id]);
	});

	it('defaults a missing model to null for nodes created without one', () => {
		const a = addNode(createGraph(), { prompt: 'hi', position: { x: 0, y: 0 } });
		assert.equal(a.node.model, null);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './graph'` (and `./layout`, `./node-wire`).

- [ ] **Step 3: Carry and edit the modules**

```bash
carry src/lib/conversation/graph.ts src/lib/canvas/graph.ts
carry src/lib/canvas/layout.ts      src/lib/canvas/layout.ts
carry src/lib/canvas/viewport.ts    src/lib/canvas/viewport.ts
sed -i '' 's#from "@/lib/conversation/graph";#from "./graph";#' src/lib/canvas/layout.ts
sed -i '' 's#from "@/lib/canvas/layout";#from "./layout";#' src/lib/canvas/viewport.ts
python3 - <<'EOF'
p = 'src/lib/canvas/graph.ts'
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
rep('import type { ChatMessage } from "@/lib/providers/types";\nimport type { ErrorCode } from "@/lib/http";',
    'import type { ChatMessage } from "../shared/chat-types";\nimport type { NodeErrorCode } from "../shared/error-codes";\nimport {\n  MAX_MESSAGES as MAX_BRANCH_MESSAGES,\n  MAX_MESSAGE_CHARS,\n  MAX_TOTAL_CHARS as MAX_BRANCH_CHARS,\n} from "../shared/chat-limits";')
rep('''/**
 * Caps enforced by `POST /api/chat`. Mirrored here so an over-long branch is
 * caught before a round trip rather than after one.
 *
 * These are duplicated from `src/app/api/chat/route.ts`, which does not export
 * them. They must not drift — see the note on [TES-4](/TES/issues/TES-4).
 */
export const MAX_BRANCH_MESSAGES = 100;
export const MAX_MESSAGE_CHARS = 100_000;
export const MAX_BRANCH_CHARS = 400_000;''',
'''/** The caps `POST /api/chat` enforces, imported so the canvas checks the same numbers. */
export { MAX_BRANCH_MESSAGES, MAX_MESSAGE_CHARS, MAX_BRANCH_CHARS };''')
rep('export type NodeError = {\n  code: ErrorCode;', 'export type NodeError = {\n  code: NodeErrorCode;')
rep('  usage: { inputTokens: number; outputTokens: number } | null;\n  createdAt: number;',
    '  usage: { inputTokens: number; outputTokens: number } | null;\n  /** The model that answered (or will answer) this exchange. */\n  model: string | null;\n  createdAt: number;')
rep('  /** Injectable so tests are deterministic. */\n  id?: string;',
    '  model?: string | null;\n  /** Injectable so tests are deterministic. */\n  id?: string;')
rep('    usage: null,\n    createdAt: now,', '    usage: null,\n    model: input.model ?? null,\n    createdAt: now,')
start = s.index('export function newNodeId(): string {')
s = s[:start] + '''export function newNodeId(): string {
  // The nodes table keys on uuid. crypto.randomUUID exists in every secure
  // context (https, localhost) and in Node, which is everywhere this runs.
  return crypto.randomUUID();
}
'''
open(p, 'w').write(s)
EOF
grep -rn '@/' src/lib/canvas || echo "no @/ imports left"
```

Expected: `no @/ imports left`.

`src/lib/canvas/node-wire.ts`:

```ts
import type { ConversationGraph, ConversationNode, NodeError, NodeStatus } from './graph';

/** One node as it travels between the browser and `PUT /api/nodes` / the canvas load. */
export type NodeWire = {
	id: string;
	parentId: string | null;
	prompt: string;
	response: string;
	thinking: string;
	status: NodeStatus;
	error: NodeError | null;
	usage: { inputTokens: number; outputTokens: number } | null;
	model: string | null;
	x: number;
	y: number;
	positionMode: 'auto' | 'manual';
	width: number | null;
	height: number | null;
	collapsed: boolean;
	bodyCollapsed: boolean;
	/** Epoch milliseconds. */
	createdAt: number;
	updatedAt: number;
};

export type ViewWire = {
	viewport: { x: number; y: number; zoom: number };
	targetNodeId: string | null;
};

export function toWire(node: ConversationNode): NodeWire {
	return {
		id: node.id,
		parentId: node.parentId,
		prompt: node.prompt,
		response: node.response,
		thinking: node.thinking,
		status: node.status,
		error: node.error,
		usage: node.usage,
		model: node.model,
		x: node.position.x,
		y: node.position.y,
		positionMode: node.positionMode,
		width: node.size?.width ?? null,
		height: node.size?.height ?? null,
		collapsed: node.collapsed,
		bodyCollapsed: node.bodyCollapsed,
		createdAt: node.createdAt,
		updatedAt: node.updatedAt
	};
}

/** Rebuilds a graph, creation-ordered so every parent precedes its children. */
export function fromWire(wires: readonly NodeWire[]): ConversationGraph {
	const sorted = [...wires].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	const nodesById: Record<string, ConversationNode> = {};
	for (const w of sorted) {
		nodesById[w.id] = {
			id: w.id,
			parentId: w.parentId,
			prompt: w.prompt,
			response: w.response,
			thinking: w.thinking,
			status: w.status,
			error: w.error,
			position: { x: w.x, y: w.y },
			positionMode: w.positionMode,
			size: w.width !== null && w.height !== null ? { width: w.width, height: w.height } : null,
			collapsed: w.collapsed,
			bodyCollapsed: w.bodyCollapsed,
			usage: w.usage,
			model: w.model,
			createdAt: w.createdAt,
			updatedAt: w.updatedAt
		};
	}
	return { nodesById, nodeIds: sorted.map((w) => w.id) };
}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: PASS — graph 23, layout 19, node-wire 4 tests, plus everything earlier.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/canvas
git commit -m "feat(canvas): carry the graph model and layout; add the node wire format and model field

Node ids are always UUIDs now (the nodes table keys on uuid) and the
graph imports the chat limits instead of keeping its own copy.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Browser transport, error presentation and copy

**Files:**
- Create (carried, edited): `src/lib/canvas/api-client.ts`, `src/lib/canvas/stream.ts`, `src/lib/canvas/stream.test.ts`, `src/lib/canvas/copy.ts`, `src/lib/canvas/copy.test.ts`
- Create: `src/lib/canvas/errors.ts`, `src/lib/canvas/errors.test.ts`, `src/lib/canvas/format.ts`, `src/lib/canvas/format.test.ts`

**Interfaces:**
- Consumes: `ApiErrorBody`, `NodeErrorCode` (Task 1), `ChatMessage`, `ChatStreamEvent` (Task 1), `NodeError` (Task 2).
- Produces:
  - `class ApiCallError extends Error { code: NodeErrorCode; fields: Record<string,string>; retryAfterSeconds?: number }`; `apiRequest`, `apiFetch<T>(path, { method?, body?, signal?, keepalive? })`; `readRateLimit(headers)`; `type RateLimitSnapshot = { limit; remaining; resetSeconds }`. A fetch that never reaches the server rejects with code `'network'`.
  - `streamChat({ model, messages, system?, signal?, onEvent, onRateLimit? }): Promise<{ completed: boolean }>` — no `provider` field.
  - `presentError(error: NodeError): { kind: ErrorKind; category: string; message: string }`, `toNodeError(error: unknown): NodeError`, `TIMEOUT_ERROR: NodeError`, `type ErrorKind = 'auth' | 'timeout' | 'network' | 'declined' | 'too_long' | 'rate_limited' | 'provider' | 'unknown'`
  - `COPY`, `copy(key, vars?)`, `type CopyKey` — with new keys `composer.newConversation`, `composer.label`, `node.thinking`, `save.failed.banner`
  - `formatDuration(seconds: number): string`

- [ ] **Step 1: Carry the tests; write the new ones**

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/lib/conversation/stream.test.ts src/lib/canvas/stream.test.ts
carry src/lib/canvas/copy.test.ts         src/lib/canvas/copy.test.ts
python3 - <<'EOF'
p = 'src/lib/canvas/stream.test.ts'
s = open(p).read()
def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old, s.count(old))
    s = s.replace(old, new)
rep('import { ApiCallError } from "@/lib/api-client";', 'import { ApiCallError } from "./api-client";')
rep('import type { ChatStreamEvent } from "@/lib/providers/types";', 'import type { ChatStreamEvent } from "../shared/chat-types";')
rep('  provider: "anthropic",\n', '')
rep('  model: "claude-opus-5",', '  model: "claude-opus-5-5",')
rep('assert.equal(error.code, "internal_error");', 'assert.equal(error.code, "network");')
open(p, 'w').write(s)
EOF
```

`src/lib/canvas/errors.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiCallError } from './api-client';
import { COPY } from './copy';
import { presentError, TIMEOUT_ERROR, toNodeError } from './errors';

describe('presentError', () => {
	it('maps a rejected or missing key to the auth line', () => {
		for (const code of ['invalid_api_key', 'no_key_configured'] as const) {
			const p = presentError({ code, message: 'x' });
			assert.equal(p.kind, 'auth');
			assert.equal(p.message, COPY['node.error.auth']);
		}
	});

	it('maps the client-only codes by code, never by message text', () => {
		assert.equal(presentError({ code: 'network', message: 'anything' }).kind, 'network');
		assert.equal(presentError(TIMEOUT_ERROR).kind, 'timeout');
	});

	it('shows a refusal as declined, with the server sentence', () => {
		const p = presentError({ code: 'model_declined', message: 'The model declined to answer this request. Try rephrasing it.' });
		assert.equal(p.kind, 'declined');
		assert.equal(p.category, 'Declined');
		assert.match(p.message, /declined/);
	});

	it('shows rate limits and provider trouble in the server words', () => {
		assert.equal(presentError({ code: 'rate_limited', message: 'Try again in 12 minutes.' }).message, 'Try again in 12 minutes.');
		assert.equal(presentError({ code: 'provider_unavailable', message: 'Could not reach Anthropic.' }).message, 'Could not reach Anthropic.');
	});

	it('treats an over-long branch as too long', () => {
		assert.equal(presentError({ code: 'payload_too_large', message: 'x' }).kind, 'too_long');
		assert.equal(presentError({ code: 'invalid_request', message: 'This branch is too long to send.' }).kind, 'too_long');
	});

	it('never shows an unexpected message verbatim', () => {
		const p = presentError({ code: 'internal_error', message: 'TypeError: x is undefined' });
		assert.equal(p.kind, 'unknown');
		assert.equal(p.message, COPY['node.error.unknown']);
	});
});

describe('toNodeError', () => {
	it('keeps an API error’s code and message', () => {
		assert.deepEqual(toNodeError(new ApiCallError('rate_limited', 'Slow down.')), { code: 'rate_limited', message: 'Slow down.' });
	});

	it('hides anything else behind a generic internal_error', () => {
		const e = toNodeError(new Error('secret detail'));
		assert.equal(e.code, 'internal_error');
		assert.doesNotMatch(e.message, /secret/);
	});
});
```

`src/lib/canvas/format.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDuration } from './format';

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
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — `./stream`, `./copy`, `./errors`, `./format`, `./api-client` not found.

- [ ] **Step 3: Carry and edit; implement errors and format**

```bash
carry src/lib/api-client.ts            src/lib/canvas/api-client.ts
carry src/lib/conversation/stream.ts   src/lib/canvas/stream.ts
carry src/lib/canvas/copy.ts           src/lib/canvas/copy.ts
python3 - <<'EOF'
import re
def edit(p, pairs):
    s = open(p).read()
    for old, new, count in pairs:
        assert s.count(old) == count, (p, old, s.count(old))
        s = s.replace(old, new)
    open(p, 'w').write(s)

# api-client: shared codes, network code, keepalive
p = 'src/lib/canvas/api-client.ts'
s = open(p).read()
s = s.replace('import type { ApiErrorBody, ErrorCode } from "@/lib/http";', 'import type { ApiErrorBody, NodeErrorCode } from "../shared/error-codes";')
s = re.sub(r'\bErrorCode\b', 'NodeErrorCode', s)
s = s.replace('import type { ApiErrorBody, NodeNodeErrorCode }', 'import type { ApiErrorBody, NodeErrorCode }')
open(p, 'w').write(s)
edit(p, [
  ('throw new ApiCallError(\n      "internal_error",\n      "Could not reach the server.', 'throw new ApiCallError(\n      "network",\n      "Could not reach the server.', 1),
  ('  signal?: AbortSignal;\n};', '  signal?: AbortSignal;\n  /** Lets a save outlive the page (pagehide). Browsers cap the body at 64 KB. */\n  keepalive?: boolean;\n};', 1),
  ('      signal: init?.signal,\n    });', '      signal: init?.signal,\n      keepalive: init?.keepalive,\n    });', 1),
])

# stream: relative imports, no provider, network code
edit('src/lib/canvas/stream.ts', [
  ('import { ApiCallError } from "@/lib/api-client";', 'import { ApiCallError } from "./api-client";', 1),
  ('import type { ApiErrorBody } from "@/lib/http";', 'import type { ApiErrorBody } from "../shared/error-codes";', 1),
  ('import type { ChatMessage, ChatStreamEvent } from "@/lib/providers/types";', 'import type { ChatMessage, ChatStreamEvent } from "../shared/chat-types";', 1),
  ('  provider: string;\n', '', 1),
  ('        provider: request.provider,\n', '', 1),
  ('throw new ApiCallError(\n      "internal_error",\n      "Could not reach the server.', 'throw new ApiCallError(\n      "network",\n      "Could not reach the server.', 1),
])

# copy: hourly limit wording, no Settings page, per-node save banner, new keys
edit('src/lib/canvas/copy.ts', [
  ('"limit.chip": "{used} / {total} today",', '"limit.chip": "{used} / {total} this hour",', 1),
  ('"You\'ve used your {total} messages for today. Resets in {time}.",', '"You\'ve used your {total} messages for this hour. Resets in {time}.",', 1),
  ('"composer.placeholder.rateLimited": "Daily limit reached",', '"composer.placeholder.rateLimited": "Hourly limit reached",', 1),
  ('"node.error.auth": "Your model key was rejected. Check it in Settings.",', '"node.error.auth": "Your model key was rejected. Reconnect it on the key page.",', 1),
  ('"save.tooLarge.banner":\n    "This canvas is too large to save. New changes will be lost on reload until you delete some nodes.",',
   '"save.failed.banner":\n    "Some changes aren\'t saved yet. They keep retrying while this tab stays open.",\n  "composer.newConversation": "New conversation",\n  "composer.label": "Message",\n  "node.thinking": "Reasoning summary",', 1),
])
EOF
grep -rn '@/' src/lib/canvas || echo "no @/ imports left"
```

In `src/lib/canvas/stream.ts`, delete its own `export type RateLimitSnapshot = { … };` and `export function readRateLimit(…) { … }` (the duplicates of api-client's), and add to the imports:

```ts
import { readRateLimit, type RateLimitSnapshot } from "./api-client";
export type { RateLimitSnapshot };
```

`src/lib/canvas/errors.ts`:

```ts
import { ApiCallError } from './api-client';
import { COPY } from './copy';
import type { NodeError } from './graph';

export type ErrorKind = 'auth' | 'timeout' | 'network' | 'declined' | 'too_long' | 'rate_limited' | 'provider' | 'unknown';

const CATEGORY: Record<ErrorKind, string> = {
	auth: 'Auth error',
	timeout: 'Timed out',
	network: 'Network error',
	declined: 'Declined',
	too_long: 'Too long',
	rate_limited: 'Limit reached',
	provider: 'Provider error',
	unknown: 'Error'
};

/** The first-token watchdog's failure (streams.ts times out; the store records this). */
export const TIMEOUT_ERROR: NodeError = { code: 'timeout', message: 'No response arrived within the time limit.' };

/** A card's failure line, chosen by code — never by matching message text. */
export function presentError(error: NodeError): { kind: ErrorKind; category: string; message: string } {
	const as = (kind: ErrorKind, message: string) => ({ kind, category: CATEGORY[kind], message });
	switch (error.code) {
		case 'invalid_api_key':
		case 'no_key_configured':
			return as('auth', COPY['node.error.auth']);
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

`src/lib/canvas/format.ts`:

```ts
/** "Resets in …" wording for the limit banner. */
export function formatDuration(seconds: number): string {
	if (seconds < 60) return 'under a minute';
	if (seconds <= 90 * 60) {
		const minutes = Math.ceil(seconds / 60);
		return minutes === 1 ? '1 minute' : `${minutes} minutes`;
	}
	return `${Math.ceil(seconds / 3600)} hours`;
}
```

- [ ] **Step 4: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: PASS — stream 12 (carried, now `network` for an unreachable server), copy (carried), errors 8, format 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas
git commit -m "feat(canvas): stream client, fetch wrapper, error presentation by code, and fixed copy

The chat limit is per hour, so the limit strings say so; 'Settings' is
now 'the key page'; refusals and client failures are matched by code.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: Markdown, XSS-inert

**Files:**
- Create: `src/lib/canvas/markdown.ts`, `src/lib/canvas/markdown.test.ts`, `src/lib/components/canvas/Markdown.svelte`

**Interfaces:**
- Produces: `type Inline = { kind: 'text' | 'strong' | 'code'; text: string }`, `type Block = { kind: 'paragraph'; inline: Inline[] } | { kind: 'list'; ordered: boolean; items: Inline[][] } | { kind: 'code'; text: string }`, `parseMarkdown(text: string): Block[]`, `parseInline(text: string): Inline[]`; component `Markdown` with props `{ text: string; streaming?: boolean }`.

- [ ] **Step 1: Write the failing test** — `src/lib/canvas/markdown.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
	it('renders a plain paragraph', () => {
		assert.deepEqual(parseMarkdown('Hello there.'), [{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Hello there.' }] }]);
	});

	it('joins a paragraph’s lines and splits paragraphs on blank lines', () => {
		const blocks = parseMarkdown('one\ntwo\n\nthree');
		assert.equal(blocks.length, 2);
		assert.deepEqual(blocks[0], { kind: 'paragraph', inline: [{ kind: 'text', text: 'one two' }] });
	});

	it('parses **bold** and `inline code`', () => {
		assert.deepEqual(parseInline('This is **important**, run `npm i`.'), [
			{ kind: 'text', text: 'This is ' },
			{ kind: 'strong', text: 'important' },
			{ kind: 'text', text: ', run ' },
			{ kind: 'code', text: 'npm i' },
			{ kind: 'text', text: '.' }
		]);
	});

	it('parses a fenced code block, keeping text around it', () => {
		const blocks = parseMarkdown('Before.\n\n```js\nconst x = 1;\n```\n\nAfter.');
		assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'code', 'paragraph']);
		assert.deepEqual(blocks[1], { kind: 'code', text: 'const x = 1;' });
	});

	it('parses numbered and bulleted lists', () => {
		const [ol] = parseMarkdown('1. Fork\n2. Rootline');
		assert.deepEqual(ol, { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'Fork' }], [{ kind: 'text', text: 'Rootline' }]] });
		const [ul] = parseMarkdown('- Alpha\n* Beta');
		assert.equal(ul.kind === 'list' && ul.ordered, false);
	});

	it('leaves an unclosed fence (mid-stream) as prose', () => {
		assert.deepEqual(parseMarkdown('```js\nconst').map((b) => b.kind), ['paragraph']);
	});

	it('treats HTML as text — there is no HTML node type to produce', () => {
		const text = '<img src=x onerror="alert(1)"> and <script>alert(2)</script>';
		const blocks = parseMarkdown(text);
		assert.deepEqual(blocks, [{ kind: 'paragraph', inline: [{ kind: 'text', text }] }]);
	});

	it('returns nothing for empty text', () => {
		assert.deepEqual(parseMarkdown(''), []);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './markdown'`.

- [ ] **Step 3: Implement**

`src/lib/canvas/markdown.ts`:

```ts
/**
 * The four constructs replies need — paragraphs, fenced code, lists, inline
 * **bold** / `code` — parsed into plain data. The component renders these
 * with text interpolation only, so nothing a model writes can become markup.
 */
export type Inline = { kind: 'text' | 'strong' | 'code'; text: string };

export type Block =
	| { kind: 'paragraph'; inline: Inline[] }
	| { kind: 'list'; ordered: boolean; items: Inline[][] }
	| { kind: 'code'; text: string };

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const UNORDERED_ITEM = /^\s*[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+\.\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

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

function parseProse(block: string): Block | null {
	const lines = block.split('\n').filter((line) => line.trim() !== '');
	if (lines.length === 0) return null;
	const ordered = ORDERED_ITEM.test(lines[0]);
	if (ordered || UNORDERED_ITEM.test(lines[0])) {
		const pattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
		return { kind: 'list', ordered, items: lines.map((line) => parseInline(line.match(pattern)?.[1] ?? line)) };
	}
	return { kind: 'paragraph', inline: parseInline(lines.join(' ')) };
}

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	const pushProse = (segment: string) => {
		for (const chunk of segment.split(/\n\s*\n/)) {
			const block = parseProse(chunk);
			if (block) blocks.push(block);
		}
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
```

`src/lib/components/canvas/Markdown.svelte`:

```svelte
<!-- Renders parsed blocks with text interpolation only: no {@html}, ever. -->
<script lang="ts">
	import { parseMarkdown, type Inline } from '$lib/canvas/markdown';

	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();
	const blocks = $derived(parseMarkdown(text));
	const caretInline = $derived(streaming && blocks.at(-1)?.kind === 'paragraph');
</script>

{#snippet inline(parts: Inline[])}{#each parts as part, i (i)}{#if part.kind === 'strong'}<strong>{part.text}</strong>{:else if part.kind === 'code'}<code>{part.text}</code>{:else}{part.text}{/if}{/each}{/snippet}

<div class="md">
	{#each blocks as block, b (b)}
		{#if block.kind === 'paragraph'}
			<p>{@render inline(block.inline)}{#if caretInline && b === blocks.length - 1}<span class="caret" aria-hidden="true"></span>{/if}</p>
		{:else if block.kind === 'list' && block.ordered}
			<ol>{#each block.items as item, i (i)}<li>{@render inline(item)}</li>{/each}</ol>
		{:else if block.kind === 'list'}
			<ul>{#each block.items as item, i (i)}<li>{@render inline(item)}</li>{/each}</ul>
		{:else}
			<pre><code>{block.text}</code></pre>
		{/if}
	{/each}
	{#if streaming && !caretInline}<span class="caret" aria-hidden="true"></span>{/if}
</div>

<style>
	.md {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	p,
	ol,
	ul,
	pre {
		margin: 0;
	}
	ol,
	ul {
		padding-left: 20px;
	}
	ol {
		list-style-type: decimal;
	}
	ul {
		list-style-type: disc;
	}
	code {
		font: var(--text-code);
		background: color-mix(in srgb, currentColor 10%, transparent);
		border-radius: var(--radius-sm);
		padding: 0 4px;
	}
	pre {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, currentColor 8%, transparent);
		overflow-x: auto;
	}
	pre code {
		background: none;
		padding: 0;
	}
	.caret {
		display: inline-block;
		width: 0.5em;
		height: 1em;
		margin-left: 2px;
		vertical-align: text-bottom;
		background: currentColor;
		animation: blink 1s steps(2) infinite;
	}
	@keyframes blink {
		to {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.caret {
			animation: none;
		}
	}
</style>
```

- [ ] **Step 4: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: PASS — markdown 8 tests; `pnpm check` 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/markdown.ts src/lib/canvas/markdown.test.ts src/lib/components/canvas/Markdown.svelte
git commit -m "feat(canvas): XSS-inert markdown — a block parser and a text-only renderer

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: Fake Messages streaming and the server-side chat stream

**Files:**
- Modify: `tests/support/fake-anthropic.ts`
- Modify: `src/lib/server/anthropic.ts`, `src/lib/server/anthropic.test.ts`
- Create: `src/lib/server/chat.ts`, `src/lib/server/chat.test.ts`

**Interfaces:**
- Consumes: `ModelSpec`, `findModel` (Task 1); `ChatMessage`, `ChatStreamEvent` (Task 1); chat limits (Task 1); `clientFor`, `toApiError`, `ApiError` (Plan 1).
- Produces:
  - Fake: `startFakeAnthropic(port?): Promise<{ url: string; requests: RecordedRequest[]; close(): Promise<void> }>`, `type RecordedRequest = { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }`; HTTP `POST /v1/messages` (stream), `GET /__requests`, `POST /__reset`. Prompt markers in the last user message: `[think]` (thinking summary first), `[refuse]` (stop_reason refusal), `[slow]` (60 ms per token), `[long]` (600 words), `[huge]` (~350 KB, ends with `END-OF-HUGE`), `[markdown]` (markdown + HTML sample). Default reply: `Echo: <prompt>. ` + 40 words.
  - `streamChat({ apiKey, model: ModelSpec, system?, messages, signal }): AsyncGenerator<ChatStreamEvent>`
  - `parseChatBody(body: Record<string, unknown>): { model: ModelSpec; messages: ChatMessage[]; system?: string }` (throws `ApiError`)

- [ ] **Step 1: Extend the fake** — replace `tests/support/fake-anthropic.ts` with:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The only key the fake accepts. Shaped like a real key; not a real key. */
export const GOOD_KEY = 'sk-ant-api03-FAKE-test-key-000000000000000000000000000000-good';

export type RecordedRequest = {
	path: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
};

const WORDS = (
	'The canvas keeps every branch of a conversation side by side so you can compare where ' +
	'each direction went and come back to any of them later without losing the original path'
).split(' ');

function words(seed: string, n: number): string {
	let h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		h = (h * 1103515245 + 12345) >>> 0;
		out.push(WORDS[h % WORDS.length]);
		if (i % 40 === 39) out.push('\n\n');
	}
	return out.join(' ').replace(/ \n\n /g, '\n\n');
}

function plan(prompt: string) {
	const clean = prompt.replace(/\[[a-z]+\]/g, '').trim().slice(0, 60);
	let text = `Echo: ${clean}. ${words(prompt, prompt.includes('[long]') ? 600 : 40)}`;
	if (prompt.includes('[huge]')) text = `${words(prompt, 50_000)} END-OF-HUGE`;
	if (prompt.includes('[markdown]')) {
		text =
			'Here is **bold** and `code`.\n\n- first\n- second\n\n```js\nconst x = 1;\n```\n\n' +
			'<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>';
	}
	return {
		thinking: prompt.includes('[think]') ? 'Weighing two readings of the question before answering.' : null,
		text,
		refuse: prompt.includes('[refuse]'),
		tokenMs: prompt.includes('[slow]') ? 60 : Number(process.env.FAKE_ANTHROPIC_TOKEN_MS ?? 3),
		wordsPerDelta: prompt.includes('[huge]') ? 500 : 1
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

function sse(res: ServerResponse, event: string, data: unknown) {
	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chunks(text: string, perDelta: number): string[] {
	const tokens = text.match(/\S+\s*/g) ?? [];
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i += perDelta) out.push(tokens.slice(i, i + perDelta).join(''));
	return out;
}

async function streamMessage(res: ServerResponse, body: Record<string, unknown>) {
	const messages = (body.messages as { role: string; content: unknown }[]) ?? [];
	const last = [...messages].reverse().find((m) => m.role === 'user');
	const p = plan(typeof last?.content === 'string' ? last.content : '');
	let closed = false;
	res.on('close', () => (closed = true));
	res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
	sse(res, 'message_start', {
		type: 'message_start',
		message: {
			id: 'msg_fake',
			type: 'message',
			role: 'assistant',
			model: body.model,
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 1 }
		}
	});
	let index = 0;
	if (p.thinking) {
		sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
		for (const piece of chunks(p.thinking, 1)) {
			if (closed) return;
			sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: piece } });
			await sleep(p.tokenMs);
		}
		sse(res, 'content_block_stop', { type: 'content_block_stop', index });
		index += 1;
	}
	if (p.refuse) {
		sse(res, 'message_delta', {
			type: 'message_delta',
			delta: { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: null, explanation: null } },
			usage: { output_tokens: 1 }
		});
		sse(res, 'message_stop', { type: 'message_stop' });
		return res.end();
	}
	sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
	const pieces = chunks(p.text, p.wordsPerDelta);
	for (const piece of pieces) {
		if (closed) return;
		sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
		await sleep(p.tokenMs);
	}
	sse(res, 'content_block_stop', { type: 'content_block_stop', index });
	sse(res, 'message_delta', {
		type: 'message_delta',
		delta: { stop_reason: 'end_turn', stop_sequence: null },
		usage: { output_tokens: pieces.length }
	});
	sse(res, 'message_stop', { type: 'message_stop' });
	res.end();
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				resolve({});
			}
		});
	});
}

/** Point the SDK at it with ANTHROPIC_BASE_URL=<url>. Test infrastructure only. */
export function startFakeAnthropic(
	port = 0
): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
	const requests: RecordedRequest[] = [];
	const server = createServer(async (req, res) => {
		const path = (req.url ?? '').split('?')[0];
		if (path === '/__requests' && req.method === 'GET') return send(res, 200, requests);
		if (path === '/__reset' && req.method === 'POST') {
			requests.length = 0;
			return send(res, 200, {});
		}
		if (req.headers['x-api-key'] !== GOOD_KEY) {
			return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
		}
		if (req.method === 'GET' && path.startsWith('/v1/models')) {
			return send(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
		}
		if (req.method === 'POST' && path === '/v1/messages') {
			const body = await readBody(req);
			requests.push({ path, headers: req.headers, body });
			if (body.stream !== true) return send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'fake streams only' } });
			return streamMessage(res, body);
		}
		send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
	});
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const { port: bound } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${bound}`,
				requests,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections();
						server.close(() => done());
					})
			});
		});
	});
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/server/anthropic.test.ts` (add `streamChat` to the `./anthropic` import and `import { findModel } from '../shared/models';` and `import type { ChatStreamEvent } from '../shared/chat-types';` to the imports):

```ts
async function collect(model: string, prompt: string, signal = new AbortController().signal, key = GOOD_KEY) {
	const events: ChatStreamEvent[] = [];
	for await (const e of streamChat({ apiKey: key, model: findModel(model)!, messages: [{ role: 'user', content: prompt }], signal })) {
		events.push(e);
	}
	return events;
}

describe('streamChat', () => {
	it('streams text and finishes with usage', async () => {
		const events = await collect('claude-opus-5-5', 'hello there');
		const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
		assert.match(text, /^Echo: hello there\./);
		const done = events.at(-1);
		assert.equal(done?.type, 'done');
	});

	it('sends adaptive summarized thinking, medium effort and default fallbacks for Opus 5.5', async () => {
		fake.requests.length = 0;
		await collect('claude-opus-5-5', 'check the request');
		const { body, headers } = fake.requests.at(-1)!;
		assert.equal(body.model, 'claude-opus-5-5');
		assert.equal(body.max_tokens, 64000);
		assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
		assert.deepEqual(body.output_config, { effort: 'medium' });
		assert.equal(body.fallbacks, 'default');
		assert.match(String(headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
	});

	it('omits thinking, effort and fallbacks for Haiku 4.5', async () => {
		fake.requests.length = 0;
		await collect('claude-haiku-4-5', 'quick one');
		const { body, headers } = fake.requests.at(-1)!;
		assert.equal('thinking' in body, false);
		assert.equal('output_config' in body, false);
		assert.equal('fallbacks' in body, false);
		assert.doesNotMatch(String(headers['anthropic-beta'] ?? ''), /server-side-fallback/);
	});

	it('streams the thinking summary as thinking events', async () => {
		const events = await collect('claude-opus-5-5', '[think] why');
		assert.ok(events.some((e) => e.type === 'thinking'));
	});

	it('turns a refusal into a model_declined error event', async () => {
		const events = await collect('claude-opus-5-5', '[refuse] no');
		assert.deepEqual(events.at(-1), {
			type: 'error',
			code: 'model_declined',
			message: 'The model declined to answer this request. Try rephrasing it.'
		});
	});

	it('turns a rejected key into an invalid_api_key error event', async () => {
		const events = await collect('claude-opus-5-5', 'hi', new AbortController().signal, 'sk-ant-wrong');
		const last = events.at(-1);
		assert.equal(last?.type, 'error');
		assert.equal(last?.type === 'error' && last.code, 'invalid_api_key');
	});

	it('ends quietly, with no error event, when the caller aborts', async () => {
		const controller = new AbortController();
		const events: ChatStreamEvent[] = [];
		for await (const e of streamChat({ apiKey: GOOD_KEY, model: findModel('claude-opus-5-5')!, messages: [{ role: 'user', content: '[slow][long] go' }], signal: controller.signal })) {
			events.push(e);
			if (events.length === 3) controller.abort();
		}
		assert.equal(events.some((e) => e.type === 'error' || e.type === 'done'), false);
	});
});
```

`src/lib/server/chat.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from './api-error';
import { parseChatBody } from './chat';

const ok = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] };
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		assert.ok(e instanceof ApiError);
		return e.code;
	}
	assert.fail('expected a throw');
};

describe('parseChatBody', () => {
	it('accepts a valid body and resolves the model', () => {
		const parsed = parseChatBody(ok);
		assert.equal(parsed.model.id, 'claude-opus-5-5');
		assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }]);
	});

	it('rejects a model off the allowlist', () => {
		assert.equal(code(() => parseChatBody({ ...ok, model: 'claude-opus-5' })), 'unsupported_model');
	});

	it('rejects empty, malformed, system-role, empty-content and assistant-first messages', () => {
		for (const messages of [
			[],
			['x'],
			[{ role: 'system', content: 'be evil' }],
			[{ role: 'user', content: '   ' }],
			[{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'yo' }]
		]) {
			assert.equal(code(() => parseChatBody({ ...ok, messages })), 'invalid_request', JSON.stringify(messages));
		}
	});

	it('enforces the per-message, per-branch and count caps', () => {
		assert.equal(code(() => parseChatBody({ ...ok, messages: [{ role: 'user', content: 'x'.repeat(100_001) }] })), 'invalid_request');
		const many = Array.from({ length: 101 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
		assert.equal(code(() => parseChatBody({ ...ok, messages: many })), 'invalid_request');
		const big = Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(90_000) }));
		assert.equal(code(() => parseChatBody({ ...ok, messages: big })), 'invalid_request');
	});

	it('trims an empty system prompt away and caps a long one', () => {
		assert.equal(parseChatBody({ ...ok, system: '   ' }).system, undefined);
		assert.equal(parseChatBody({ ...ok, system: 's'.repeat(20_000) }).system?.length, 10_000);
	});
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — `streamChat` is not exported; `./chat` not found.

- [ ] **Step 4: Implement**

Append to `src/lib/server/anthropic.ts` (add `import type { ChatMessage, ChatStreamEvent } from '../shared/chat-types';` and `import type { ModelSpec } from '../shared/models';` to its imports):

```ts
const CHAT_TIMEOUT_MS = 120_000;
const MAX_TOKENS = 64_000;
const DECLINED = 'The model declined to answer this request. Try rephrasing it.';

/**
 * Streams one reply as our own transport-neutral events. Thinking summaries
 * are on wherever the model takes adaptive thinking, so the card has
 * something real to show while the model works. Refusals are retried on
 * Anthropic's recommended fallback on the same stream; text already sent
 * stays valid, so the relay needs no special handling for it.
 */
export async function* streamChat(options: {
	apiKey: string;
	model: ModelSpec;
	system?: string;
	messages: ChatMessage[];
	signal: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
	const { model } = options;
	const params = {
		model: model.id,
		max_tokens: MAX_TOKENS,
		...(model.thinking === 'adaptive' ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
		...(model.effort ? { output_config: { effort: model.effort } } : {}),
		...(model.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
		...(options.system ? { system: options.system } : {}),
		messages: options.messages.map((m) => ({ role: m.role, content: m.content }))
	};
	const client = clientFor(options.apiKey, CHAT_TIMEOUT_MS);
	try {
		const stream = client.beta.messages.stream(
			params as unknown as Parameters<typeof client.beta.messages.stream>[0],
			{ signal: options.signal }
		);
		for await (const event of stream) {
			if (event.type !== 'content_block_delta') continue;
			if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
			else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', text: event.delta.thinking };
		}
		const final = await stream.finalMessage();
		// A refusal is an HTTP 200 with stop_reason "refusal": check before trusting content.
		if (final.stop_reason === 'refusal') {
			yield { type: 'error', code: 'model_declined', message: DECLINED };
			return;
		}
		yield {
			type: 'done',
			stopReason: final.stop_reason ?? 'end_turn',
			usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens }
		};
	} catch (error) {
		if (options.signal.aborted) return; // the browser went away or pressed Stop
		const apiError = toApiError(error, 'chat');
		yield { type: 'error', code: apiError.code, message: apiError.message };
	}
}
```

`src/lib/server/chat.ts`:

```ts
import { MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_SYSTEM_CHARS, MAX_TOTAL_CHARS } from '../shared/chat-limits';
import type { ChatMessage } from '../shared/chat-types';
import { findModel, type ModelSpec } from '../shared/models';
import { ApiError } from './api-error';

/** Validates POST /api/chat. The client decides the content of a branch, never its size. */
export function parseChatBody(body: Record<string, unknown>): { model: ModelSpec; messages: ChatMessage[]; system?: string } {
	const model = findModel(body.model);
	if (!model) throw new ApiError('unsupported_model', 'That model is not available.');
	const system = typeof body.system === 'string' && body.system.trim() !== '' ? body.system.slice(0, MAX_SYSTEM_CHARS) : undefined;
	return { model, messages: parseMessages(body.messages), ...(system ? { system } : {}) };
}

function parseMessages(value: unknown): ChatMessage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new ApiError('invalid_request', 'Send at least one message.', { fields: { messages: 'Send at least one message.' } });
	}
	if (value.length > MAX_MESSAGES) {
		throw new ApiError('invalid_request', `This branch is too long — it holds more than ${MAX_MESSAGES} messages.`);
	}
	let total = 0;
	const messages: ChatMessage[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) throw new ApiError('invalid_request', 'A message was malformed.');
		const { role, content } = entry as Record<string, unknown>;
		// An allowlist of two: a client that could send "system" could rewrite the instructions.
		if (role !== 'user' && role !== 'assistant') throw new ApiError('invalid_request', 'A message had an unknown role.');
		if (typeof content !== 'string' || content.trim() === '') throw new ApiError('invalid_request', 'A message was empty.');
		if (content.length > MAX_MESSAGE_CHARS) throw new ApiError('invalid_request', 'One message is too long.');
		total += content.length;
		if (total > MAX_TOTAL_CHARS) throw new ApiError('invalid_request', 'This branch is too long to send. Start a new node from further up.');
		messages.push({ role, content });
	}
	if (messages[0].role !== 'user') throw new ApiError('invalid_request', 'A conversation has to start with a message from you.');
	return messages;
}
```

- [ ] **Step 5: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: PASS — anthropic 3 + 7, chat 5. If the SDK's beta stream rejects `fallbacks`/`betas` inside the params object at runtime (it should pass them through), move `betas` into the request options — `{ signal, headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } }` — keep `fallbacks` in the body, and note it in the report.

- [ ] **Step 6: Commit**

```bash
git add tests/support/fake-anthropic.ts src/lib/server/anthropic.ts src/lib/server/anthropic.test.ts src/lib/server/chat.ts src/lib/server/chat.test.ts
git commit -m "feat(chat): stream replies from Anthropic with summarized thinking and refusal fallbacks

The key is passed in by the caller (decrypted only in /api/chat after the
session check) and never logged; it lives only in provider_keys.ciphertext
under AES-256-GCM. A fake Messages server streams realistic SSE for tests.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: The chat relay route and the e2e seeding rig

**Files:**
- Create: `src/routes/api/chat/+server.ts`, `tests/support/seed-server.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/chat-api.spec.ts`
- Modify: `tests/support/e2e-server.ts`, `.gitignore`

**Interfaces:**
- Consumes: `withRoute`, `readJsonBody`, `ApiError` (Plan 1); `assertSameOrigin`; `enforce`, `POLICIES`, `rateLimitHeaders`, `userSubject`; `getDecryptedKey`; `parseChatBody` (Task 5); `streamChat` (Task 5); `MAX_BODY_BYTES` (Task 1); seed modules: `hashPassword`, `createSession`, `saveKey`, `query`, `queryOne`.
- Produces:
  - `POST /api/chat` — body `{ model, messages, system? }` → `text/event-stream` of `data: <ChatStreamEvent>\n\n` frames; pre-stream failures are the JSON envelope; `RateLimit-*` headers on every response.
  - Seed server (test-only, port 4012): `POST /seed` `{ key?: boolean = true; nodes?: number = 0; chatUsed?: number = 0 }` → `{ email, token, userId }`.
  - Fixtures: `test` (Playwright `test` extended with `signIn(options?)` → `{ email, userId }`), `expect`, `FAKE_ANTHROPIC = 'http://127.0.0.1:4011'`, `anthropicRequests(): Promise<RecordedRequest[]>`, `resetAnthropic(): Promise<void>`.

- [ ] **Step 1: Seed server and e2e wiring**

`tests/support/seed-server.ts`:

```ts
// TEST-ONLY. Lets browser tests start signed in without spending the real
// sign-up / sign-in rate limits. Runs inside tests/support/e2e-server.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createSession } from '../../src/lib/server/auth/session';
import { hashPassword } from '../../src/lib/server/crypto/password';
import { query, queryOne } from '../../src/lib/server/db';
import { saveKey } from '../../src/lib/server/keys';
import { GOOD_KEY } from './fake-anthropic';

export type SeedRequest = { key?: boolean; nodes?: number; chatUsed?: number };
export type SeedResponse = { email: string; token: string; userId: string };

export async function seedUser({ key = true, nodes = 0, chatUsed = 0 }: SeedRequest): Promise<SeedResponse> {
	const email = `seed-${randomBytes(6).toString('hex')}@e2e.test`;
	const user = await queryOne<{ id: string }>('insert into users (email, password_hash) values ($1, $2) returning id', [
		email,
		await hashPassword('seeded-password-not-used')
	]);
	const userId = user!.id;
	if (key) await saveKey(userId, GOOD_KEY);
	const ids: string[] = [];
	for (let i = 0; i < nodes; i++) {
		const id = randomUUID();
		const parentId = i === 0 ? null : ids[Math.floor((i - 1) / 2)];
		await query(
			`insert into nodes (id, user_id, parent_id, prompt, response, status, x, y, position_mode, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, 'complete', $6, $7, 'auto', now() + ($8 || ' milliseconds')::interval, now())`,
			[id, userId, parentId, `Seeded question ${i + 1}`, 'Seeded answer. '.repeat(20 + (i % 5) * 12), (i % 10) * 520, Math.floor(i / 10) * 420, String(i)]
		);
		ids.push(id);
	}
	if (chatUsed > 0) {
		const windowMs = 3600_000;
		await query('insert into rate_limits (bucket, subject, window_start, count) values ($1, $2, $3, $4)', [
			'chat',
			`user:${userId}`,
			new Date(Math.floor(Date.now() / windowMs) * windowMs),
			chatUsed
		]);
	}
	const { token } = await createSession(userId);
	return { email, token, userId };
}

export function startSeedServer(port: number): Promise<{ close: () => Promise<void> }> {
	const server = createServer((req, res) => {
		if (req.method !== 'POST' || req.url !== '/seed') {
			res.writeHead(404).end();
			return;
		}
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', async () => {
			try {
				const seeded = await seedUser(raw ? JSON.parse(raw) : {});
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(seeded));
			} catch (error) {
				res.writeHead(500).end(error instanceof Error ? error.name : 'error');
			}
		});
	});
	return new Promise((resolve) =>
		server.listen(port, '127.0.0.1', () => resolve({ close: () => new Promise((done) => server.close(() => done())) }))
	);
}
```

In `tests/support/e2e-server.ts`:
- add `import { startSeedServer } from './seed-server';` and `const SEED_PORT = 4012;`
- after `await migrate(...)`, add:

```ts
const vaultKey = randomBytes(32).toString('base64');
// The seed server runs the app's own modules in this process.
process.env.DATABASE_URL = url.toString();
process.env.KEY_VAULT_ENCRYPTION_KEY = vaultKey;
const seed = await startSeedServer(SEED_PORT);
```

- in the `preview` env, replace `KEY_VAULT_ENCRYPTION_KEY: randomBytes(32).toString('base64')` with `KEY_VAULT_ENCRYPTION_KEY: vaultKey`
- in `shutdown`, after `await fake.close();` add `await seed.close();`

`tests/e2e/fixtures.ts`:

```ts
import { test as base, expect } from '@playwright/test';
import type { RecordedRequest } from '../support/fake-anthropic';
import type { SeedRequest, SeedResponse } from '../support/seed-server';

export const FAKE_ANTHROPIC = 'http://127.0.0.1:4011';
const SEED = 'http://127.0.0.1:4012';

/** `signIn()` seeds a fresh user (with a key by default) and sets their session cookie. */
export const test = base.extend<{ signIn: (options?: SeedRequest) => Promise<{ email: string; userId: string }> }>({
	signIn: async ({ context }, use) => {
		await use(async (options = {}) => {
			const res = await fetch(`${SEED}/seed`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(options)
			});
			if (!res.ok) throw new Error(`seed failed: ${res.status}`);
			const seeded = (await res.json()) as SeedResponse;
			await context.addCookies([
				{ name: 'nc_session', value: seeded.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }
			]);
			return { email: seeded.email, userId: seeded.userId };
		});
	}
});

export { expect };

export async function anthropicRequests(): Promise<RecordedRequest[]> {
	return (await fetch(`${FAKE_ANTHROPIC}/__requests`)).json();
}

export async function resetAnthropic(): Promise<void> {
	await fetch(`${FAKE_ANTHROPIC}/__reset`, { method: 'POST' });
}
```

- [ ] **Step 2: Write the failing browser tests** — `tests/e2e/chat-api.spec.ts`

```ts
import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';

const body = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hello relay' }] };

test('streams SSE frames for a signed-in user with a key', async ({ page, signIn }) => {
	await signIn();
	await resetAnthropic();
	const res = await page.request.post('/api/chat', { data: body });
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('text/event-stream');
	expect(res.headers()['ratelimit-limit']).toBe('60');
	const text = await res.text();
	expect(text).toContain('"type":"text"');
	expect(text).toContain('Echo: hello relay.');
	expect(text).toContain('"type":"done"');
	const [sent] = await anthropicRequests();
	expect(sent.body.messages).toEqual(body.messages);
});

test('refuses without a session, from another site, or with a bad model', async ({ page, signIn }) => {
	expect((await page.request.post('/api/chat', { data: body })).status()).toBe(401);
	await signIn();
	expect(
		(await page.request.post('/api/chat', { data: body, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })).status()
	).toBe(403);
	const bad = await page.request.post('/api/chat', { data: { ...body, model: 'gpt-5' } });
	expect(bad.status()).toBe(400);
	expect((await bad.json()).error.code).toBe('unsupported_model');
});

test('says no key is configured before streaming', async ({ page, signIn }) => {
	await signIn({ key: false });
	const res = await page.request.post('/api/chat', { data: body });
	expect(res.status()).toBe(409);
	expect((await res.json()).error.code).toBe('no_key_configured');
});
```

Run: `pnpm test:e2e`
Expected: FAIL — `/api/chat` returns 404.

- [ ] **Step 3: Implement the route** — `src/routes/api/chat/+server.ts`

```ts
import type { Config } from '@sveltejs/adapter-vercel';
import { ApiError, readJsonBody, withRoute } from '$lib/server/api-error';
import { streamChat } from '$lib/server/anthropic';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { parseChatBody } from '$lib/server/chat';
import { getDecryptedKey } from '$lib/server/keys';
import { enforce, POLICIES, rateLimitHeaders, userSubject } from '$lib/server/rate-limit';
import { MAX_BODY_BYTES } from '$lib/shared/chat-limits';
import type { ChatStreamEvent } from '$lib/shared/chat-types';

export const config: Config = { maxDuration: 300 };

const frame = (event: ChatStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

/**
 * The stateless relay. Pre-stream failures are the JSON envelope; once the
 * stream is open, failures arrive as an `error` frame with the same codes.
 * The provider key is decrypted here, after the session check, and nowhere else.
 */
export const POST = withRoute('chat', async ({ request, locals }) => {
	assertSameOrigin(request);
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	const limit = await enforce(POLICIES.chat, userSubject(user.id));
	const { model, messages, system } = parseChatBody(await readJsonBody(request, { maxBytes: MAX_BODY_BYTES }));
	const apiKey = await getDecryptedKey(user.id);

	// Abort upstream when the browser leaves, so a closed tab stops spending the user's tokens.
	const controller = new AbortController();
	request.signal.addEventListener('abort', () => controller.abort());
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(out) {
			try {
				for await (const event of streamChat({ apiKey, model, messages, system, signal: controller.signal })) {
					out.enqueue(encoder.encode(frame(event)));
				}
			} catch (error) {
				console.error('[chat] stream failed:', error instanceof Error ? error.name : 'non-Error throw');
				out.enqueue(encoder.encode(frame({ type: 'error', code: 'internal_error', message: 'The response stopped unexpectedly. Please try again.' })));
			} finally {
				out.close();
			}
		},
		cancel() {
			controller.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-store, no-transform',
			'X-Accel-Buffering': 'no',
			...rateLimitHeaders(limit)
		}
	});
});
```

Note: `assertSameOrigin` accepts requests without an `Origin`; Playwright's `page.request` sends none, which is why the cross-site test sets `sec-fetch-site: cross-site`.

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS — 3 new browser tests plus the 8 account tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/chat tests/support tests/e2e/fixtures.ts tests/e2e/chat-api.spec.ts
git commit -m "feat(chat): POST /api/chat relay, plus a test-only seed server for browser tests

The provider key lives only in provider_keys.ciphertext (AES-256-GCM
under KEY_VAULT_ENCRYPTION_KEY, AAD \"<userId>:anthropic\"); this route is
the only place it is decrypted, after the session and rate-limit checks.
A database read still yields nothing usable.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 7: Per-node persistence — schema tweak, server module, routes, canvas load

**Files:**
- Create: `db/migrations/0002_nodes_parent_fk_deferrable.sql`, `tests/support/wire.ts`, `src/lib/server/nodes.ts`, `src/lib/server/nodes.test.ts`, `src/lib/server/nodes.dbtest.ts`, `src/routes/api/nodes/+server.ts`, `src/routes/api/nodes/[id]/+server.ts`, `src/routes/canvas/+page.server.ts`, `src/routes/canvas/+page.ts`, `tests/e2e/nodes-api.spec.ts`

**Interfaces:**
- Consumes: `NodeWire`, `ViewWire` (Task 2); limits (Task 1); `withTransaction`, `query`, `queryOne` (Plan 1); `getKeySummary`; `MODELS`, `DEFAULT_MODEL_ID`.
- Produces:
  - `MAX_SAVE_BYTES = 4 MiB`, `MAX_SAVE_NODES = 200`
  - `parseSaveBody(body): { upserts: NodeWire[]; view: ViewWire | null }` (throws `ApiError('invalid_request')`)
  - `saveNodes(userId, upserts, view): Promise<{ rejected: string[] }>` — one transaction; ids owned by another user are rejected (untouched); an unknown parent rejects the whole batch with `ApiError('invalid_request')`
  - `deleteNode(userId, id): Promise<void>` (subtree cascades), `isUuid(value): boolean`
  - `loadCanvas(userId): Promise<{ nodes: NodeWire[]; view: ViewWire | null }>`
  - `PUT /api/nodes` → `{ rejected: string[] }`; `DELETE /api/nodes/:id` → 204
  - Canvas page data: `{ nodes: NodeWire[]; view: ViewWire | null; hasKey: boolean; email: string; models: readonly ModelSpec[]; defaultModelId: string }`

- [ ] **Step 1: Migration**

`db/migrations/0002_nodes_parent_fk_deferrable.sql`:

```sql
-- Check the parent link at commit, not per row, so one save may carry a
-- child before its parent. Cascade deletes still happen immediately.
alter table nodes alter constraint nodes_parent_id_user_id_fkey deferrable initially deferred;
```

- [ ] **Step 2: Write the failing tests**

`tests/support/wire.ts` (shared by the unit and database tests):

```ts
import { randomUUID } from 'node:crypto';
import type { NodeWire } from '../../src/lib/canvas/node-wire';

export function wire(overrides: Partial<NodeWire> = {}): NodeWire {
	return {
		id: randomUUID(),
		parentId: null,
		prompt: 'hi',
		response: 'hello',
		thinking: '',
		status: 'complete',
		error: null,
		usage: { inputTokens: 1, outputTokens: 2 },
		model: 'claude-opus-5-5',
		x: 0,
		y: 0,
		positionMode: 'auto',
		width: null,
		height: null,
		collapsed: false,
		bodyCollapsed: false,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides
	};
}
```

`src/lib/server/nodes.test.ts`:

```ts
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
```

`src/lib/server/nodes.dbtest.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { ApiError } from './api-error';
import { query, queryOne } from './db';
import { wire } from '../../../tests/support/wire';
import { deleteNode, loadCanvas, saveNodes } from './nodes';

let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let a: string;
let b: string;
before(async () => {
	db = await freshDatabase();
	const make = async (email: string) =>
		(await queryOne<{ id: string }>("insert into users (email, password_hash) values ($1, 'x') returning id", [email]))!.id;
	a = await make('a@nodes.test');
	b = await make('b@nodes.test');
});
after(() => db?.drop());

const count = async (userId: string) =>
	Number((await queryOne<{ n: string }>('select count(*) as n from nodes where user_id = $1', [userId]))!.n);

describe('saveNodes / loadCanvas', () => {
	it('inserts, then updates, and loads back exactly', async () => {
		const n = wire({ createdAt: 1_700_000_000_123, updatedAt: 1_700_000_000_456 });
		await saveNodes(a, [n], { viewport: { x: 5, y: 6, zoom: 0.5 }, targetNodeId: n.id });
		await saveNodes(a, [{ ...n, response: 'edited', x: 40, updatedAt: 1_700_000_001_000 }], null);
		const loaded = await loadCanvas(a);
		assert.deepEqual(loaded.nodes, [{ ...n, response: 'edited', x: 40, updatedAt: 1_700_000_001_000 }]);
		assert.deepEqual(loaded.view, { viewport: { x: 5, y: 6, zoom: 0.5 }, targetNodeId: n.id });
	});

	it('saves a child before its parent in one batch (deferred FK)', async () => {
		const parent = wire();
		const child = wire({ parentId: parent.id });
		await saveNodes(a, [child, parent], null);
		const loaded = await loadCanvas(a);
		assert.ok(loaded.nodes.some((n) => n.id === child.id && n.parentId === parent.id));
	});

	it('rejects the whole batch when a parent does not exist, writing nothing', async () => {
		const before = await count(a);
		const fine = wire();
		const orphan = wire({ parentId: randomUUID() });
		await assert.rejects(saveNodes(a, [fine, orphan], null), (e: unknown) => e instanceof ApiError && e.code === 'invalid_request');
		assert.equal(await count(a), before);
	});

	it('never overwrites another user’s node, and reports it as rejected', async () => {
		const mine = wire({ prompt: 'b owns this' });
		await saveNodes(b, [mine], null);
		const { rejected } = await saveNodes(a, [{ ...mine, prompt: 'hijacked' }], null);
		assert.deepEqual(rejected, [mine.id]);
		const row = await queryOne<{ prompt: string; user_id: string }>('select prompt, user_id from nodes where id = $1', [mine.id]);
		assert.deepEqual(row, { prompt: 'b owns this', user_id: b });
	});

	it('ignores a view target that is not one of the user’s saved nodes', async () => {
		const foreign = (await loadCanvas(b)).nodes[0].id;
		await saveNodes(a, [], { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: foreign });
		assert.equal((await loadCanvas(a)).view?.targetNodeId, null);
		await saveNodes(a, [], { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: randomUUID() });
		assert.equal((await loadCanvas(a)).view?.targetNodeId, null);
	});

	it('saves a 390k-character response', async () => {
		const big = wire({ response: 'y'.repeat(390_000) });
		await saveNodes(a, [big], null);
		const loaded = await loadCanvas(a);
		assert.equal(loaded.nodes.find((n) => n.id === big.id)?.response.length, 390_000);
	});
});

describe('deleteNode', () => {
	it('deletes the subtree, only for its owner', async () => {
		const root = wire();
		const child = wire({ parentId: root.id });
		await saveNodes(a, [root, child], null);
		await deleteNode(b, root.id);
		assert.ok((await loadCanvas(a)).nodes.some((n) => n.id === root.id), 'another user cannot delete it');
		await deleteNode(a, root.id);
		const ids = (await loadCanvas(a)).nodes.map((n) => n.id);
		assert.ok(!ids.includes(root.id) && !ids.includes(child.id));
		await query('select 1'); // connection still healthy
	});
});
```

Run: `pnpm test && pnpm test:db`
Expected: FAIL — `./nodes` not found.

- [ ] **Step 3: Implement** `src/lib/server/nodes.ts`

```ts
import type { NodeWire, ViewWire } from '../canvas/node-wire';
import { MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } from '../shared/chat-limits';
import { ERROR_CODES } from '../shared/error-codes';
import { ApiError } from './api-error';
import { query, queryOne, withTransaction } from './db';

export const MAX_SAVE_BYTES = 4 * 1024 * 1024;
export const MAX_SAVE_NODES = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['draft', 'streaming', 'complete', 'interrupted', 'error'] as const;
const NODE_ERROR_CODES: readonly string[] = [...ERROR_CODES, 'network', 'timeout'];
const COORD = 1e7;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

function bad(message: string): never {
	throw new ApiError('invalid_request', message);
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

function parseNode(raw: unknown, i: number): NodeWire {
	if (typeof raw !== 'object' || raw === null) bad(`Node ${i} is malformed.`);
	const n = raw as Record<string, unknown>;
	if (!isUuid(n.id)) bad(`Node ${i} has a malformed id.`);
	if (n.parentId !== null && !isUuid(n.parentId)) bad(`Node ${i} has a malformed parent.`);
	if (!text(n.prompt, MAX_MESSAGE_CHARS)) bad(`Node ${i}'s prompt is too long.`);
	if (!text(n.response, MAX_TOTAL_CHARS)) bad(`Node ${i}'s response is too long.`);
	if (!text(n.thinking, MAX_TOTAL_CHARS)) bad(`Node ${i}'s thinking is too long.`);
	if (!STATUSES.includes(n.status as (typeof STATUSES)[number])) bad(`Node ${i} has an unknown status.`);
	if (n.error !== null) {
		const e = n.error as Record<string, unknown> | undefined;
		if (!e || !NODE_ERROR_CODES.includes(e.code as string) || !text(e.message, 2000)) bad(`Node ${i} has a malformed error.`);
	}
	if (n.usage !== null) {
		const u = n.usage as Record<string, unknown> | undefined;
		if (!u || !num(u.inputTokens, 0, 1e9) || !num(u.outputTokens, 0, 1e9)) bad(`Node ${i} has malformed usage.`);
	}
	if (n.model !== null && !text(n.model, 100)) bad(`Node ${i} has a malformed model.`);
	if (!num(n.x, -COORD, COORD) || !num(n.y, -COORD, COORD)) bad(`Node ${i} has a malformed position.`);
	if (n.positionMode !== 'auto' && n.positionMode !== 'manual') bad(`Node ${i} has a malformed position mode.`);
	for (const k of ['width', 'height'] as const) if (n[k] !== null && !num(n[k], 1, 10_000)) bad(`Node ${i} has a malformed size.`);
	if (typeof n.collapsed !== 'boolean' || typeof n.bodyCollapsed !== 'boolean') bad(`Node ${i} has malformed flags.`);
	if (!num(n.createdAt, 0, 8.64e15) || !num(n.updatedAt, 0, 8.64e15)) bad(`Node ${i} has malformed timestamps.`);
	return {
		id: n.id as string,
		parentId: n.parentId as string | null,
		prompt: n.prompt as string,
		response: n.response as string,
		thinking: n.thinking as string,
		status: n.status as NodeWire['status'],
		error: n.error as NodeWire['error'],
		usage: n.usage as NodeWire['usage'],
		model: n.model as string | null,
		x: n.x as number,
		y: n.y as number,
		positionMode: n.positionMode as NodeWire['positionMode'],
		width: n.width as number | null,
		height: n.height as number | null,
		collapsed: n.collapsed as boolean,
		bodyCollapsed: n.bodyCollapsed as boolean,
		createdAt: n.createdAt as number,
		updatedAt: n.updatedAt as number
	};
}

function parseView(raw: unknown): ViewWire | null {
	if (raw === undefined || raw === null) return null;
	const v = raw as Record<string, unknown>;
	const vp = v.viewport as Record<string, unknown> | undefined;
	if (!vp || !num(vp.x, -1e9, 1e9) || !num(vp.y, -1e9, 1e9) || !num(vp.zoom, 0.01, 10)) bad('The view is malformed.');
	if (v.targetNodeId !== null && !isUuid(v.targetNodeId)) bad('The view target is malformed.');
	return { viewport: { x: vp.x as number, y: vp.y as number, zoom: vp.zoom as number }, targetNodeId: v.targetNodeId as string | null };
}

export function parseSaveBody(body: Record<string, unknown>): { upserts: NodeWire[]; view: ViewWire | null } {
	if (!Array.isArray(body.upserts)) bad('Expected a list of nodes.');
	if (body.upserts.length > MAX_SAVE_NODES) bad(`Save at most ${MAX_SAVE_NODES} nodes at a time.`);
	return { upserts: body.upserts.map(parseNode), view: parseView(body.view) };
}

type NodeRow = {
	id: string;
	parent_id: string | null;
	prompt: string;
	response: string;
	thinking: string;
	status: NodeWire['status'];
	error: NodeWire['error'];
	usage: NodeWire['usage'];
	model: string | null;
	x: number;
	y: number;
	position_mode: NodeWire['positionMode'];
	width: number | null;
	height: number | null;
	collapsed: boolean;
	body_collapsed: boolean;
	created_ms: string;
	updated_ms: string;
};

/** One transaction: upsert every node the user owns, then the view. */
export async function saveNodes(userId: string, upserts: NodeWire[], view: ViewWire | null): Promise<{ rejected: string[] }> {
	const rows = upserts.map((n) => ({
		id: n.id,
		parent_id: n.parentId,
		prompt: n.prompt,
		response: n.response,
		thinking: n.thinking,
		status: n.status,
		error: n.error,
		usage: n.usage,
		model: n.model,
		x: n.x,
		y: n.y,
		position_mode: n.positionMode,
		width: n.width,
		height: n.height,
		collapsed: n.collapsed,
		body_collapsed: n.bodyCollapsed,
		created_at: n.createdAt,
		updated_at: n.updatedAt
	}));
	try {
		return await withTransaction(async (run) => {
			const saved = rows.length
				? await run<{ id: string }>(
						`insert into nodes (id, user_id, parent_id, prompt, response, thinking, status, error, usage, model,
						                    x, y, position_mode, width, height, collapsed, body_collapsed, created_at, updated_at)
						 select r.id, $1, r.parent_id, r.prompt, r.response, r.thinking, r.status, r.error, r.usage, r.model,
						        r.x, r.y, r.position_mode, r.width, r.height, r.collapsed, r.body_collapsed,
						        to_timestamp(r.created_at / 1000.0), to_timestamp(r.updated_at / 1000.0)
						   from jsonb_to_recordset($2::jsonb) as r(
						        id uuid, parent_id uuid, prompt text, response text, thinking text, status text, error jsonb,
						        usage jsonb, model text, x double precision, y double precision, position_mode text,
						        width double precision, height double precision, collapsed boolean, body_collapsed boolean,
						        created_at double precision, updated_at double precision)
						 on conflict (id) do update set
						        parent_id = excluded.parent_id, prompt = excluded.prompt, response = excluded.response,
						        thinking = excluded.thinking, status = excluded.status, error = excluded.error,
						        usage = excluded.usage, model = excluded.model, x = excluded.x, y = excluded.y,
						        position_mode = excluded.position_mode, width = excluded.width, height = excluded.height,
						        collapsed = excluded.collapsed, body_collapsed = excluded.body_collapsed,
						        updated_at = excluded.updated_at
						  where nodes.user_id = excluded.user_id
						 returning id`,
						[userId, JSON.stringify(rows)]
					)
				: [];
			if (view) {
				// The subquery drops a target that is unsaved or someone else's.
				await run(
					`insert into canvas_view (user_id, viewport, target_node_id, updated_at)
					 values ($1, $2::jsonb, (select id from nodes where id = $3 and user_id = $1), now())
					 on conflict (user_id) do update
					    set viewport = excluded.viewport, target_node_id = excluded.target_node_id, updated_at = now()`,
					[userId, JSON.stringify(view.viewport), view.targetNodeId]
				);
			}
			const accepted = new Set(saved.map((r) => r.id));
			return { rejected: upserts.map((n) => n.id).filter((id) => !accepted.has(id)) };
		});
	} catch (error) {
		if ((error as { code?: string }).code === '23503') {
			throw new ApiError('invalid_request', 'A node referenced a parent that is not on this canvas.');
		}
		throw error;
	}
}

export async function deleteNode(userId: string, id: string): Promise<void> {
	await query('delete from nodes where id = $1 and user_id = $2', [id, userId]);
}

export async function loadCanvas(userId: string): Promise<{ nodes: NodeWire[]; view: ViewWire | null }> {
	const rows = await query<NodeRow>(
		`select id, parent_id, prompt, response, thinking, status, error, usage, model, x, y, position_mode, width, height,
		        collapsed, body_collapsed,
		        (extract(epoch from created_at) * 1000)::bigint::text as created_ms,
		        (extract(epoch from updated_at) * 1000)::bigint::text as updated_ms
		   from nodes where user_id = $1 order by created_at, id`,
		[userId]
	);
	const view = await queryOne<{ viewport: ViewWire['viewport']; target_node_id: string | null }>(
		'select viewport, target_node_id from canvas_view where user_id = $1',
		[userId]
	);
	return {
		nodes: rows.map((r) => ({
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
		})),
		view: view ? { viewport: view.viewport, targetNodeId: view.target_node_id } : null
	};
}
```

Note: `x`, `y`, `width`, `height` are `real` (float4) in the schema, so a value like `40.123` reads back rounded. If the round-trip test fails on precision, add `db/migrations/0003_nodes_double_precision.sql` altering those four columns to `double precision`, and say so in the report — do not loosen the test.

Routes:

`src/routes/api/nodes/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { ApiError, readJsonBody, withRoute } from '$lib/server/api-error';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { MAX_SAVE_BYTES, parseSaveBody, saveNodes } from '$lib/server/nodes';
import { enforce, POLICIES, rateLimitHeaders, userSubject } from '$lib/server/rate-limit';

export const PUT = withRoute('nodes.put', async ({ request, locals }) => {
	assertSameOrigin(request);
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	const limit = await enforce(POLICIES.nodeWrite, userSubject(user.id));
	const { upserts, view } = parseSaveBody(await readJsonBody(request, { maxBytes: MAX_SAVE_BYTES }));
	const result = await saveNodes(user.id, upserts, view);
	return json(result, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(limit) } });
});
```

`src/routes/api/nodes/[id]/+server.ts`:

```ts
import { ApiError, withRoute } from '$lib/server/api-error';
import { assertSameOrigin } from '$lib/server/auth/csrf';
import { deleteNode, isUuid } from '$lib/server/nodes';
import { enforce, POLICIES, userSubject } from '$lib/server/rate-limit';

export const DELETE = withRoute('nodes.delete', async ({ request, locals, params }) => {
	assertSameOrigin(request);
	const user = locals.user;
	if (!user) throw new ApiError('unauthenticated', 'Please sign in to continue.');
	await enforce(POLICIES.nodeWrite, userSubject(user.id));
	if (!isUuid(params.id)) throw new ApiError('invalid_request', 'That node id is malformed.');
	await deleteNode(user.id, params.id); // the subtree cascades
	return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
```

`src/routes/canvas/+page.server.ts`:

```ts
import { getKeySummary } from '$lib/server/keys';
import { loadCanvas } from '$lib/server/nodes';
import { DEFAULT_MODEL_ID, MODELS } from '$lib/shared/models';
import type { PageServerLoad } from './$types';

/** A server load also makes the hook's sign-in guard run on client-side navigation. */
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // hooks.server.ts redirects signed-out requests
	const [canvas, key] = await Promise.all([loadCanvas(user.id), getKeySummary(user.id)]);
	return { ...canvas, hasKey: key !== null, email: user.email, models: MODELS, defaultModelId: DEFAULT_MODEL_ID };
};
```

`src/routes/canvas/+page.ts`:

```ts
// The canvas measures real DOM sizes; render it in the browser only.
export const ssr = false;
```

- [ ] **Step 4: Browser-level route tests** — `tests/e2e/nodes-api.spec.ts`

```ts
import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';

const node = (id = randomUUID(), parentId: string | null = null) => ({
	id,
	parentId,
	prompt: `hello from e2e ${id.slice(0, 6)}`,
	response: 'saved answer',
	thinking: '',
	status: 'complete',
	error: null,
	usage: null,
	model: 'claude-opus-5-5',
	x: 0,
	y: 0,
	positionMode: 'auto',
	width: null,
	height: null,
	collapsed: false,
	bodyCollapsed: false,
	createdAt: Date.now(),
	updatedAt: Date.now()
});

test('saves nodes, returns them from the canvas load, and deletes subtrees', async ({ page, signIn }) => {
	await signIn();
	const root = node();
	const child = node(randomUUID(), root.id);
	const put = await page.request.put('/api/nodes', { data: { upserts: [child, root] } });
	expect(put.status()).toBe(200);
	expect(await put.json()).toEqual({ rejected: [] });
	expect(await (await page.request.get('/canvas/__data.json')).text()).toContain(root.prompt);

	expect((await page.request.delete(`/api/nodes/${root.id}`)).status()).toBe(204);
	const after = await (await page.request.get('/canvas/__data.json')).text();
	expect(after).not.toContain(root.prompt);
	expect(after).not.toContain(child.prompt);
});

test('refuses unauthenticated, cross-site and malformed saves', async ({ page, signIn }) => {
	expect((await page.request.put('/api/nodes', { data: { upserts: [] } })).status()).toBe(401);
	await signIn();
	expect(
		(await page.request.put('/api/nodes', { data: { upserts: [] }, headers: { 'sec-fetch-site': 'cross-site' } })).status()
	).toBe(403);
	expect((await page.request.put('/api/nodes', { data: { upserts: [{ id: 'nope' }] } })).status()).toBe(400);
	expect((await page.request.delete('/api/nodes/not-a-uuid')).status()).toBe(400);
});
```

Run: `pnpm test && pnpm test:db && pnpm check && pnpm lint && pnpm test:e2e`
Expected: PASS — nodes unit 4, nodes db 7, e2e +2.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0002_nodes_parent_fk_deferrable.sql tests/support/wire.ts src/lib/server/nodes* src/routes/api/nodes src/routes/canvas/+page.server.ts src/routes/canvas/+page.ts tests/e2e/nodes-api.spec.ts
git commit -m "feat(nodes): per-node saving — PUT /api/nodes, DELETE /api/nodes/:id and the canvas load

One transaction per save; the parent FK is checked at commit so batches
may arrive child-first; another user's node id is never overwritten.

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 8: The stream queue and the saver

**Files:**
- Create: `src/lib/canvas/streams.ts`, `src/lib/canvas/streams.test.ts`, `src/lib/canvas/saver.ts`, `src/lib/canvas/saver.test.ts`

**Interfaces:**
- Consumes: `NodeWire`, `ViewWire` (Task 2).
- Produces:
  - `type RunContext = { signal: AbortSignal; activity: () => void }`, `type Run = (ctx: RunContext) => Promise<{ completed: boolean }>`, `type Outcome = { kind: 'completed' } | { kind: 'stopped' } | { kind: 'timed_out' } | { kind: 'failed'; error: unknown }`, `MAX_ACTIVE_STREAMS = 3`, `FIRST_TOKEN_TIMEOUT_MS = 60_000`
  - `class StreamQueue { constructor(settle: (id, outcome: Outcome) => void, onChange?: () => void, options?: { maxActive: number; firstTokenMs: number }, clock?: { setTimeout; clearTimeout }); enqueue(id, run): void; stop(id): void; stopAll(): void; position(id): number | null; isActive(id): boolean }`
  - `type SaveBody = { upserts: NodeWire[]; view?: ViewWire }`, `SAVE_INTERVAL_MS = 1500`, `MAX_BATCH_NODES = 200`, `MAX_BATCH_BYTES = 4 MiB − 64 KiB`, `KEEPALIVE_BYTES = 60 KiB`
  - `class Saver { constructor(deps: SaverDeps, clock?: { setInterval; clearInterval }); markNode(id); markView(); readonly pending: number; batches(): SaveBody[]; flush({ keepalive?: boolean }?): Promise<void>; start(); stop() }`
  - `type SaverDeps = { getNode(id): NodeWire | null; depthOf(id): number; getView(): ViewWire; put(body: SaveBody, keepalive: boolean): Promise<{ rejected: string[] }>; isOnline(): boolean; onError(message: string | null): void; priority(): string[]; failureMessage: string }`

- [ ] **Step 1: Write the failing tests**

`src/lib/canvas/streams.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StreamQueue, type Outcome, type RunContext } from './streams';

function fakeClock() {
	let next = 1;
	const timers = new Map<number, () => void>();
	return {
		clock: {
			setTimeout: ((fn: () => void) => {
				const id = next++;
				timers.set(id, fn);
				return id;
			}) as unknown as typeof setTimeout,
			clearTimeout: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout
		},
		fireAll: () => [...timers.entries()].forEach(([id, fn]) => (timers.delete(id), fn())),
		pending: () => timers.size
	};
}

function controllable() {
	let resolve!: (r: { completed: boolean }) => void;
	let reject!: (e: unknown) => void;
	let ctx!: RunContext;
	const promise = new Promise<{ completed: boolean }>((res, rej) => ((resolve = res), (reject = rej)));
	return { run: (c: RunContext) => ((ctx = c), promise), resolve, reject, ctx: () => ctx };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('StreamQueue', () => {
	it('runs three at a time and queues the rest in order', async () => {
		const settled: [string, Outcome][] = [];
		const q = new StreamQueue((id, o) => settled.push([id, o]), undefined, undefined, fakeClock().clock);
		const runs = ['a', 'b', 'c', 'd', 'e'].map((id) => [id, controllable()] as const);
		for (const [id, r] of runs) q.enqueue(id, r.run);
		assert.deepEqual(['a', 'b', 'c'].map((id) => q.isActive(id)), [true, true, true]);
		assert.equal(q.position('d'), 0);
		assert.equal(q.position('e'), 1);
		runs[0][1].resolve({ completed: true });
		await tick();
		assert.deepEqual(settled, [['a', { kind: 'completed' }]]);
		assert.equal(q.isActive('d'), true);
		assert.equal(q.position('e'), 0);
	});

	it('stopping a queued stream removes it without running it', async () => {
		const settled: string[] = [];
		const q = new StreamQueue((id, o) => settled.push(`${id}:${o.kind}`), undefined, { maxActive: 1, firstTokenMs: 60_000 }, fakeClock().clock);
		const a = controllable();
		let bRan = false;
		q.enqueue('a', a.run);
		q.enqueue('b', async () => ((bRan = true), { completed: true }));
		q.stop('b');
		assert.deepEqual(settled, ['b:stopped']);
		a.resolve({ completed: true });
		await tick();
		assert.equal(bRan, false);
	});

	it('stopping an active stream aborts it and settles as stopped', async () => {
		const settled: string[] = [];
		const q = new StreamQueue((id, o) => settled.push(`${id}:${o.kind}`), undefined, undefined, fakeClock().clock);
		const a = controllable();
		q.enqueue('a', a.run);
		q.stop('a');
		assert.equal(a.ctx().signal.aborted, true);
		a.resolve({ completed: false });
		await tick();
		assert.deepEqual(settled, ['a:stopped']);
	});

	it('times out a stream that produces nothing, but not one that has started', async () => {
		const settled: string[] = [];
		const c = fakeClock();
		const q = new StreamQueue((id, o) => settled.push(`${id}:${o.kind}`), undefined, undefined, c.clock);
		const silent = controllable();
		const talking = controllable();
		q.enqueue('silent', silent.run);
		q.enqueue('talking', talking.run);
		talking.ctx().activity();
		c.fireAll();
		assert.equal(silent.ctx().signal.aborted, true);
		assert.equal(talking.ctx().signal.aborted, false);
		silent.resolve({ completed: false });
		await tick();
		assert.deepEqual(settled, ['silent:timed_out']);
	});

	it('reports a thrown run as failed with its error', async () => {
		let outcome: Outcome | undefined;
		const q = new StreamQueue((_id, o) => (outcome = o), undefined, undefined, fakeClock().clock);
		const a = controllable();
		q.enqueue('a', a.run);
		const boom = new Error('boom');
		a.reject(boom);
		await tick();
		assert.deepEqual(outcome, { kind: 'failed', error: boom });
	});
});
```

`src/lib/canvas/saver.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeWire, ViewWire } from './node-wire';
import { MAX_BATCH_BYTES, Saver, type SaveBody, type SaverDeps } from './saver';

function node(id: string, extra: Partial<NodeWire> = {}): NodeWire {
	return {
		id, parentId: null, prompt: 'p', response: 'r', thinking: '', status: 'complete', error: null, usage: null,
		model: null, x: 0, y: 0, positionMode: 'auto', width: null, height: null, collapsed: false,
		bodyCollapsed: false, createdAt: 1, updatedAt: 1, ...extra
	};
}

function harness(nodes: Record<string, NodeWire>, depth: Record<string, number> = {}) {
	const sent: { body: SaveBody; keepalive: boolean }[] = [];
	const errors: (string | null)[] = [];
	let failNext: unknown = null;
	let online = true;
	const view: ViewWire = { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null };
	const deps: SaverDeps = {
		getNode: (id) => nodes[id] ?? null,
		depthOf: (id) => depth[id] ?? 0,
		getView: () => view,
		put: async (body, keepalive) => {
			if (failNext) {
				const e = failNext;
				failNext = null;
				throw e;
			}
			sent.push({ body, keepalive });
			return { rejected: [] };
		},
		isOnline: () => online,
		onError: (m) => errors.push(m),
		priority: () => [],
		failureMessage: 'not saved'
	};
	const saver = new Saver(deps, { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: (() => {}) as unknown as typeof clearInterval });
	return { saver, sent, errors, fail: (e: unknown) => (failNext = e), setOnline: (v: boolean) => (online = v) };
}

describe('Saver', () => {
	it('sends dirty nodes parents first, with the view, in one request', async () => {
		const h = harness({ c: node('c'), p: node('p') }, { c: 2, p: 1 });
		h.saver.markNode('c');
		h.saver.markNode('p');
		h.saver.markView();
		await h.saver.flush();
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['p', 'c']);
		assert.ok(h.sent[0].body.view);
		assert.equal(h.saver.pending, 0);
		assert.deepEqual(h.errors, [null]);
	});

	it('splits more than 200 nodes into ordered batches', async () => {
		const nodes = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`n${i}`, node(`n${i}`)]));
		const h = harness(nodes);
		Object.keys(nodes).forEach((id) => h.saver.markNode(id));
		await h.saver.flush();
		assert.deepEqual(h.sent.map((s) => s.body.upserts.length), [200, 200, 50]);
	});

	it('splits by bytes when nodes are large', () => {
		const big = 'x'.repeat(390_000);
		const nodes = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`b${i}`, node(`b${i}`, { response: big })]));
		const h = harness(nodes);
		Object.keys(nodes).forEach((id) => h.saver.markNode(id));
		const batches = h.saver.batches();
		assert.ok(batches.length >= 2);
		for (const b of batches) assert.ok(new TextEncoder().encode(JSON.stringify(b)).byteLength <= MAX_BATCH_BYTES);
		assert.equal(batches.flatMap((b) => b.upserts).length, 15);
	});

	it('drops nodes that no longer exist instead of retrying them forever', async () => {
		const h = harness({ kept: node('kept') });
		h.saver.markNode('kept');
		h.saver.markNode('deleted');
		await h.saver.flush();
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['kept']);
		assert.equal(h.saver.pending, 0);
	});

	it('keeps ids dirty and raises the banner on a server failure, then clears it', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.fail({ code: 'internal_error' });
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved']);
		assert.equal(h.saver.pending, 1);
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved', null]);
		assert.equal(h.saver.pending, 0);
	});

	it('keeps ids dirty without a banner on a network failure', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.fail({ code: 'network' });
		await h.saver.flush();
		assert.deepEqual(h.errors, []);
		assert.equal(h.saver.pending, 1);
	});

	it('waits while offline', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.setOnline(false);
		await h.saver.flush();
		assert.equal(h.sent.length, 0);
	});

	it('keeps changes made during a request for the next flush', async () => {
		const nodes = { a: node('a') };
		const h = harness(nodes);
		h.saver.markNode('a');
		const first = h.saver.flush();
		h.saver.markNode('a');
		await first;
		assert.equal(h.saver.pending, 1);
	});

	it('sends a keepalive request under 60 KB, streaming nodes first, without clearing', async () => {
		const big = 'x'.repeat(40_000);
		const h = harness({ a: node('a', { response: big }), s: node('s', { response: big, status: 'streaming' }) });
		(h.saver as unknown as { deps: SaverDeps }).deps.priority = () => ['s'];
		h.saver.markNode('a');
		h.saver.markNode('s');
		await h.saver.flush({ keepalive: true });
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0].keepalive, true);
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['s']);
		assert.equal(h.saver.pending, 2);
	});
});
```

Run: `pnpm test`
Expected: FAIL — `./streams`, `./saver` not found.

- [ ] **Step 2: Implement**

`src/lib/canvas/streams.ts`:

```ts
/**
 * Runs at most `maxActive` replies at once, FIFO beyond that, with a
 * first-token watchdog. Knows nothing about graphs or HTTP: a Run gets an
 * abort signal and an `activity()` callback, and the queue reports how it ended.
 */
export type RunContext = { signal: AbortSignal; activity: () => void };
export type Run = (ctx: RunContext) => Promise<{ completed: boolean }>;
export type Outcome = { kind: 'completed' } | { kind: 'stopped' } | { kind: 'timed_out' } | { kind: 'failed'; error: unknown };

export const MAX_ACTIVE_STREAMS = 3;
export const FIRST_TOKEN_TIMEOUT_MS = 60_000;

type Clock = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
type Active = { controller: AbortController; timer: ReturnType<typeof setTimeout> | null; timedOut: boolean; stopped: boolean };

export class StreamQueue {
	private queue: { id: string; run: Run }[] = [];
	private active = new Map<string, Active>();

	constructor(
		private readonly settle: (id: string, outcome: Outcome) => void,
		private readonly onChange: () => void = () => {},
		private readonly options = { maxActive: MAX_ACTIVE_STREAMS, firstTokenMs: FIRST_TOKEN_TIMEOUT_MS },
		private readonly clock: Clock = { setTimeout, clearTimeout }
	) {}

	enqueue(id: string, run: Run): void {
		this.queue.push({ id, run });
		this.pump();
		this.onChange();
	}

	/** 0-based place in the queue, or null when running or unknown. */
	position(id: string): number | null {
		const i = this.queue.findIndex((q) => q.id === id);
		return i === -1 ? null : i;
	}

	isActive(id: string): boolean {
		return this.active.has(id);
	}

	stop(id: string): void {
		const i = this.position(id);
		if (i !== null) {
			this.queue.splice(i, 1);
			this.onChange();
			this.settle(id, { kind: 'stopped' });
			return;
		}
		const entry = this.active.get(id);
		if (entry) {
			entry.stopped = true;
			entry.controller.abort();
		}
	}

	stopAll(): void {
		for (const { id } of [...this.queue]) this.stop(id);
		for (const id of [...this.active.keys()]) this.stop(id);
	}

	private pump(): void {
		while (this.active.size < this.options.maxActive && this.queue.length > 0) {
			const next = this.queue.shift()!;
			this.begin(next.id, next.run);
		}
	}

	private begin(id: string, run: Run): void {
		const entry: Active = { controller: new AbortController(), timer: null, timedOut: false, stopped: false };
		entry.timer = this.clock.setTimeout(() => {
			entry.timedOut = true;
			entry.controller.abort();
		}, this.options.firstTokenMs);
		this.active.set(id, entry);
		const activity = () => {
			if (entry.timer !== null) {
				this.clock.clearTimeout(entry.timer);
				entry.timer = null;
			}
		};
		run({ signal: entry.controller.signal, activity }).then(
			(result) =>
				this.finish(id, entry, entry.timedOut ? { kind: 'timed_out' } : result.completed && !entry.stopped ? { kind: 'completed' } : { kind: 'stopped' }),
			(error: unknown) =>
				this.finish(id, entry, entry.timedOut ? { kind: 'timed_out' } : entry.stopped ? { kind: 'stopped' } : { kind: 'failed', error })
		);
	}

	private finish(id: string, entry: Active, outcome: Outcome): void {
		if (entry.timer !== null) this.clock.clearTimeout(entry.timer);
		this.active.delete(id);
		this.settle(id, outcome);
		this.pump();
		this.onChange();
	}
}
```

`src/lib/canvas/saver.ts`:

```ts
import type { NodeWire, ViewWire } from './node-wire';

export type SaveBody = { upserts: NodeWire[]; view?: ViewWire };

export type SaverDeps = {
	getNode(id: string): NodeWire | null;
	depthOf(id: string): number;
	getView(): ViewWire;
	put(body: SaveBody, keepalive: boolean): Promise<{ rejected: string[] }>;
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

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const isNetwork = (error: unknown) => (error as { code?: unknown } | null)?.code === 'network';

/** Remembers which nodes changed and sends only those, parents first. */
export class Saver {
	private dirty = new Set<string>();
	private viewDirty = false;
	private inFlight: Promise<void> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private deps: SaverDeps,
		private readonly clock = { setInterval, clearInterval }
	) {}

	markNode(id: string): void {
		this.dirty.add(id);
	}

	markView(): void {
		this.viewDirty = true;
	}

	get pending(): number {
		return this.dirty.size + (this.viewDirty ? 1 : 0);
	}

	start(): void {
		this.timer ??= this.clock.setInterval(() => void this.flush(), SAVE_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer !== null) this.clock.clearInterval(this.timer);
		this.timer = null;
	}

	/** The requests a flush would send now. Vanished nodes are dropped from the dirty set. */
	batches(): SaveBody[] {
		const nodes: NodeWire[] = [];
		for (const id of this.dirty) {
			const n = this.deps.getNode(id);
			if (n) nodes.push(n);
			else this.dirty.delete(id);
		}
		nodes.sort((a, b) => this.deps.depthOf(a.id) - this.deps.depthOf(b.id) || a.createdAt - b.createdAt);
		const out: SaveBody[] = [];
		let current: SaveBody = { upserts: [] };
		let size = bytes(current);
		for (const n of nodes) {
			const s = bytes(n) + 1;
			if (current.upserts.length > 0 && (current.upserts.length >= MAX_BATCH_NODES || size + s > MAX_BATCH_BYTES)) {
				out.push(current);
				current = { upserts: [] };
				size = bytes(current);
			}
			current.upserts.push(n);
			size += s;
		}
		if (this.viewDirty) current.view = this.deps.getView();
		if (current.upserts.length > 0 || current.view) out.push(current);
		return out;
	}

	flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
		if (keepalive) return this.flushKeepalive();
		if (this.inFlight) return this.inFlight;
		if (!this.deps.isOnline() || this.pending === 0) return Promise.resolve();
		this.inFlight = this.run().finally(() => (this.inFlight = null));
		return this.inFlight;
	}

	private async run(): Promise<void> {
		const batches = this.batches();
		this.dirty.clear();
		this.viewDirty = false;
		for (let i = 0; i < batches.length; i++) {
			try {
				await this.deps.put(batches[i], false);
			} catch (error) {
				// Everything not yet confirmed goes back to dirty; changes made meanwhile are already there.
				for (const b of batches.slice(i)) {
					b.upserts.forEach((n) => this.dirty.add(n.id));
					if (b.view) this.viewDirty = true;
				}
				if (!isNetwork(error)) this.deps.onError(this.deps.failureMessage);
				return;
			}
		}
		this.deps.onError(null);
	}

	/** Unload path: one request under the browser's keepalive cap; nothing is cleared. */
	private async flushKeepalive(): Promise<void> {
		const first = this.deps.priority().filter((id) => this.dirty.has(id));
		const rest = [...this.dirty].filter((id) => !first.includes(id));
		const body: SaveBody = { upserts: [], ...(this.viewDirty ? { view: this.deps.getView() } : {}) };
		let size = bytes(body);
		for (const id of [...first, ...rest]) {
			const n = this.deps.getNode(id);
			if (!n) continue;
			const s = bytes(n) + 1;
			if (size + s > KEEPALIVE_BYTES) continue;
			body.upserts.push(n);
			size += s;
		}
		if (body.upserts.length === 0 && !body.view) return;
		await this.deps.put(body, true).catch(() => {});
	}
}
```

Note the keepalive test: the streaming node `s` (≈40 KB) fits; `a` (≈40 KB more) would exceed 60 KB, so only `s` is sent.

- [ ] **Step 3: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: PASS — streams 5, saver 9.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/streams.ts src/lib/canvas/streams.test.ts src/lib/canvas/saver.ts src/lib/canvas/saver.test.ts
git commit -m "feat(canvas): stream queue (3 at a time, FIFO, 60 s watchdog) and the per-node saver

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 9: The canvas — store, cards, composer, top bar, page

**Files:**
- Create: `src/lib/canvas/store.svelte.ts`, `src/lib/styles/canvas-tokens.css` (carried), `src/lib/components/canvas/{CanvasApp,Canvas,NodeCard,Composer,TopBar,EmptyState}.svelte`, `tests/e2e/canvas.spec.ts`
- Modify: `src/routes/canvas/+page.svelte` (replace the placeholder)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces:
  - `class CanvasStore` with `$state` fields `graph`, `target`, `following`, `layoutVersion`, `queueVersion`, `model`, `rateLimit`, `saveError`, `online`; `width`; `viewport`; injectables `measure`, `visibleCenter`; methods `start()`, `dispose()`, `label(id)`, `sendBlockedReason` (getter), `send(prompt): boolean`, `branch(id)`, `newConversation()`, `stop(id)`, `moved(id, position)`, `tidy()`, `setViewport(vp)`, `setModel(id)`, `queuePosition(id)`, `limitReached` (getter)
  - `provideCanvas(store)`, `useCanvas(): CanvasStore`
  - DOM contract used by browser tests: `article[data-node-id][data-parent-id][data-status]`; `[data-testid="card-body"]`; `button[aria-label="Branch"]`; Composer `[data-testid="composer-target"][data-target-id]`, textarea labelled "Message"; top bar buttons "Tidy", "Fit", select labelled "Model".

- [ ] **Step 1: Write the failing browser tests** — `tests/e2e/canvas.spec.ts`

```ts
import { anthropicRequests, expect, resetAnthropic, test } from './fixtures';
import type { Page } from '@playwright/test';

const cards = (page: Page) => page.locator('article[data-node-id]');

async function send(page: Page, prompt: string, { wait = true } = {}) {
	const before = await cards(page).count();
	await page.getByLabel('Message').fill(prompt);
	await page.getByLabel('Message').press('Enter');
	await expect(cards(page)).toHaveCount(before + 1);
	const card = cards(page).last();
	const id = (await card.getAttribute('data-node-id'))!;
	if (wait) await expect(card).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
	return id;
}

/** Waits until the canvas load returns `needle` — i.e. the saver has flushed. */
async function waitSaved(page: Page, needle: string) {
	await expect.poll(async () => (await page.request.get('/canvas/__data.json')).text(), { timeout: 15_000 }).toContain(needle);
}

test('without a key, the canvas sends you to connect one', async ({ page, signIn }) => {
	await signIn({ key: false });
	await page.goto('/canvas');
	await expect(page.getByText('Connect a model to start')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Connect model access' })).toHaveAttribute('href', '/keys');
});

test('send, stream, and find it again after a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await expect(page.getByText('Ask anything. Then take it three directions.')).toBeVisible();
	const id = await send(page, 'first question');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('Echo: first question.');
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', id);
	await waitSaved(page, 'Echo: first question.');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${id}"]`)).toContainText('Echo: first question.');
	await expect(page.locator(`article[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'complete');
});

test('branching sends exactly the ancestor path', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'root question');
	const b = await send(page, 'second question');
	await page.locator(`article[data-node-id="${a}"] button[aria-label="Branch"]`).click();
	await expect(page.getByTestId('composer-target')).toHaveAttribute('data-target-id', a);
	await resetAnthropic();
	const c = await send(page, 'forked question');
	await expect(page.locator(`article[data-node-id="${c}"]`)).toHaveAttribute('data-parent-id', a);
	const [sent] = await anthropicRequests();
	const prompts = (sent.body.messages as { role: string; content: string }[]).map((m) => `${m.role}:${m.content.slice(0, 20)}`);
	expect(prompts).toEqual(['user:root question', expect.stringMatching(/^assistant:Echo: root question/), 'user:forked question']);
	expect(b).not.toBe(c);
});

test('markdown renders and HTML stays text', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[markdown] format please');
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card.locator('strong')).toHaveText('bold');
	await expect(card.locator('li')).toHaveCount(2);
	await expect(card.locator('pre code')).toHaveText('const x = 1;');
	await expect(card.locator('img')).toHaveCount(0);
	await expect(card).toContainText('<img src=x onerror=');
	expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('shows the reasoning summary, and a refusal as declined', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const thought = await send(page, '[think] consider this');
	await expect(page.locator(`article[data-node-id="${thought}"] details summary`)).toHaveText('Reasoning summary');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const refused = await send(page, '[refuse] nope', { wait: false });
	const card = page.locator(`article[data-node-id="${refused}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText('The model declined to answer this request.');
});

test('stop keeps the partial reply', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const stopped = await send(page, '[slow][long] stop me', { wait: false });
	const card = page.locator(`article[data-node-id="${stopped}"]`);
	await expect(card).toContainText('Echo: stop me.');
	await card.getByRole('button', { name: 'Stop' }).click();
	await expect(card).toHaveAttribute('data-status', 'interrupted');
	await expect(card).toContainText('Stopped');
});

test('reload mid-stream keeps the partial reply as stopped', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const reloaded = await send(page, '[slow][long] reload me', { wait: false });
	await expect(page.locator(`article[data-node-id="${reloaded}"]`)).toContainText('Echo: reload me.');
	await waitSaved(page, 'Echo: reload me.');
	await page.reload();
	const after = page.locator(`article[data-node-id="${reloaded}"]`);
	await expect(after).toHaveAttribute('data-status', 'interrupted');
	await expect(after).toContainText('Echo: reload me.');
	// This user has no other node, so "interrupted" in the saved data is this one, saved back.
	await waitSaved(page, '"interrupted"');
});

test('a 350 KB reply survives a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[huge] write a lot');
	await waitSaved(page, 'END-OF-HUGE');
	await page.reload();
	await expect(page.locator(`article[data-node-id="${id}"]`)).toContainText('END-OF-HUGE');
});
```

Run: `pnpm test:e2e`
Expected: FAIL — the canvas page is still the Plan 1 placeholder.

- [ ] **Step 2: Carry the canvas tokens**

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/app/canvas-tokens.css src/lib/styles/canvas-tokens.css
```

(The file scopes everything under `.canvas-surface`; the cyanotype colours are the `--cy-*` tokens.)

- [ ] **Step 3: The store** — `src/lib/canvas/store.svelte.ts`

```ts
import { getContext, setContext } from 'svelte';
import { apiFetch, type RateLimitSnapshot } from './api-client';
import { copy } from './copy';
import { TIMEOUT_ERROR, toNodeError } from './errors';
import {
	addNode,
	appendText,
	appendThinking,
	canBranchFrom,
	checkBranchSize,
	completeNode,
	failNode,
	interruptNode,
	moveNode,
	pathToRoot,
	settleOrphanedStreams,
	startStreaming,
	toMessages,
	type ConversationGraph
} from './graph';
import { autoPlaceOnCreate, centeredRootPosition, NODE_WIDTH_DESKTOP, reflowChildrenOnCreate, tidyLayout, type NodeHeights } from './layout';
import { fromWire, toWire, type NodeWire, type ViewWire } from './node-wire';
import { Saver, type SaveBody } from './saver';
import { streamChat } from './stream';
import { StreamQueue, type Outcome } from './streams';
import type { Viewport } from './viewport';
import type { ChatStreamEvent } from '../shared/chat-types';

type Point = { x: number; y: number };
export type CanvasInit = { nodes: NodeWire[]; view: ViewWire | null; model: string };

export class CanvasStore {
	graph = $state.raw<ConversationGraph>({ nodesById: {}, nodeIds: [] });
	/** Changed only by Branch, send, New conversation (Plan 3 adds Enter-on-focus and delete). */
	target = $state<string | null>(null);
	following = $state<string | null>(null);
	layoutVersion = $state(0);
	queueVersion = $state(0);
	model = $state('');
	rateLimit = $state<RateLimitSnapshot | null>(null);
	saveError = $state<string | null>(null);
	online = $state(true);

	readonly width = NODE_WIDTH_DESKTOP;
	viewport: Viewport;
	measure: () => NodeHeights = () => new Map();
	visibleCenter: () => Point = () => ({ x: 0, y: 0 });

	private readonly streams: StreamQueue;
	private readonly saver: Saver;
	private readonly cleanups: (() => void)[] = [];

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
		this.cleanups.forEach((f) => f());
		this.saver.stop();
		this.streams.stopAll();
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

	get sendBlockedReason(): string | null {
		if (!this.online) return copy('composer.placeholder.offline');
		if (this.limitReached) return copy('composer.placeholder.rateLimited');
		const t = this.target ? this.graph.nodesById[this.target] : null;
		if (t && !canBranchFrom(t)) return copy('branch.disabled');
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

	send(prompt: string): boolean {
		const text = prompt.trim();
		if (!text || this.sendBlockedReason) return false;
		const parentId = this.target;
		const heights = this.measure();
		const position = parentId
			? autoPlaceOnCreate(this.graph, parentId, this.width, heights)
			: this.graph.nodeIds.length === 0
				? centeredRootPosition(this.visibleCenter(), this.width)
				: autoPlaceOnCreate(this.graph, null, this.width, heights);
		const added = addNode(this.graph, { parentId, prompt: text, position, model: this.model });
		let graph = parentId ? reflowChildrenOnCreate(added.graph, parentId, this.width, heights) : added.graph;
		const id = added.node.id;
		const tooLong = checkBranchSize(toMessages(graph, id));
		graph = tooLong ? failNode(graph, id, { code: 'invalid_request', message: tooLong.message }) : startStreaming(graph, id);
		this.commit(graph);
		this.target = id;
		this.following = id;
		this.layoutVersion++;
		this.saver.markView();
		if (!tooLong) this.enqueue(id);
		return true;
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
		if (snapshot.remaining === 0) {
			setTimeout(() => {
				if (this.rateLimit === snapshot) this.rateLimit = { ...snapshot, remaining: snapshot.limit };
			}, snapshot.resetSeconds * 1000);
		}
	}

	private apply(id: string, event: ChatStreamEvent): void {
		if (!this.graph.nodesById[id]) return;
		if (event.type === 'text') this.commit(appendText(this.graph, id, event.text));
		else if (event.type === 'thinking') this.commit(appendThinking(this.graph, id, event.text));
		else if (event.type === 'done') this.commit(completeNode(this.graph, id, event.usage));
		else this.commit(failNode(this.graph, id, { code: event.code, message: event.message }));
	}

	private settle(id: string, outcome: Outcome): void {
		const node = this.graph.nodesById[id];
		if (!node || node.status !== 'streaming') return; // a terminal frame already landed
		if (outcome.kind === 'stopped') this.commit(interruptNode(this.graph, id));
		else if (outcome.kind === 'timed_out') this.commit(failNode(this.graph, id, TIMEOUT_ERROR));
		else if (outcome.kind === 'failed') this.commit(failNode(this.graph, id, toNodeError(outcome.error)));
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
}

const KEY = Symbol('canvas');
export const provideCanvas = (store: CanvasStore) => setContext(KEY, store);
export const useCanvas = () => getContext<CanvasStore>(KEY);
```

- [ ] **Step 4: Components and page**

`src/lib/components/canvas/EmptyState.svelte`:

```svelte
<script lang="ts">
	import { resolve } from '$app/paths';
	import { copy } from '$lib/canvas/copy';

	let { variant }: { variant: 'no-key' | 'empty' } = $props();
</script>

<div class="empty" class:overlay={variant === 'empty'}>
	{#if variant === 'no-key'}
		<h1>{copy('provider.headline')}</h1>
		<p>{copy('provider.sub')}</p>
		<a class="cta" href={resolve('/keys')}>{copy('provider.cta')}</a>
	{:else}
		<h2>{copy('empty.headline')}</h2>
		<p>{copy('empty.sub')}</p>
	{/if}
</div>

<style>
	.empty {
		max-width: 520px;
		margin: 15vh auto 0;
		padding: 0 var(--space-6);
		text-align: center;
		color: var(--cy-ink, var(--foreground));
	}
	.overlay {
		position: absolute;
		inset: 20% 0 auto;
		margin: 0 auto;
		pointer-events: none;
	}
	h1,
	h2 {
		margin: 0 0 var(--space-2);
	}
	p {
		margin: 0 0 var(--space-6);
		opacity: 0.8;
	}
	.cta {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--foreground);
		color: var(--background);
		text-decoration: none;
	}
</style>
```

`src/lib/components/canvas/NodeCard.svelte`:

```svelte
<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { copy } from '$lib/canvas/copy';
	import { presentError } from '$lib/canvas/errors';
	import { canBranchFrom } from '$lib/canvas/graph';
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
			<h3 class="prompt" title={node.prompt}>{node.prompt}</h3>
			{#if status}<span class="status">{status}</span>{/if}
			{#if node.status === 'streaming'}
				<button class="nodrag" type="button" onclick={() => store.stop(id)}>Stop</button>
			{/if}
			<button
				class="nodrag"
				type="button"
				aria-label="Branch"
				title={canBranchFrom(node) ? undefined : copy('branch.disabled')}
				disabled={!canBranchFrom(node)}
				onclick={() => store.branch(id)}>{copy('node.action.branch')}</button
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
</style>
```

`src/lib/components/canvas/Composer.svelte`:

```svelte
<script lang="ts">
	import { copy } from '$lib/canvas/copy';
	import { useCanvas } from '$lib/canvas/store.svelte';

	const store = useCanvas();
	let text = $state('');
	let field = $state<HTMLTextAreaElement>();
	const blocked = $derived(store.sendBlockedReason);
	const placeholder = $derived(blocked ?? (store.target ? copy('composer.placeholder.reply') : copy('composer.placeholder')));

	function submit() {
		if (store.send(text)) text = '';
	}

	/** Used by the empty state's starter prompts (Task 10). */
	export function draft(value: string) {
		text = value;
		field?.focus();
	}
</script>

<form
	class="composer"
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<div class="target" data-testid="composer-target" data-target-id={store.target ?? ''}>
		{copy('composer.target', { label: store.label(store.target) })}
		{#if store.target}
			<button type="button" class="link" onclick={() => store.newConversation()}>{copy('composer.newConversation')}</button>
		{/if}
	</div>
	<div class="row">
		<label class="sr-only" for="composer-input">{copy('composer.label')}</label>
		<textarea
			id="composer-input"
			bind:this={field}
			bind:value={text}
			rows="2"
			{placeholder}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
					e.preventDefault();
					submit();
				}
			}}
		></textarea>
		<button type="submit" disabled={!text.trim() || !!blocked}>Send</button>
	</div>
</form>

<style>
	.composer {
		padding: var(--space-3) var(--space-6) var(--space-4);
		border-top: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
	}
	.target {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		font: var(--text-xs);
		color: var(--cy-ink-soft);
		margin-bottom: var(--space-2);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		max-width: 860px;
	}
	textarea {
		flex: 1;
		font: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		resize: none;
	}
	button[type='submit'] {
		min-width: 88px;
		border-radius: var(--radius-md);
		border: 0;
		background: var(--cy-gold);
		color: var(--cy-paper-deep);
		font-weight: 600;
		cursor: pointer;
	}
	button[type='submit']:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.link {
		border: 0;
		background: none;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
```

`src/lib/components/canvas/TopBar.svelte`:

```svelte
<script lang="ts">
	import { resolve } from '$app/paths';
	import { useSvelteFlow } from '@xyflow/svelte';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import type { ModelSpec } from '$lib/shared/models';

	let { models, email }: { models: readonly ModelSpec[]; email: string } = $props();
	const store = useCanvas();
	const flow = useSvelteFlow();
</script>

<header class="topbar">
	<a class="wordmark" href={resolve('/')}>node-canvas</a>
	<label class="model">
		Model
		<select value={store.model} onchange={(e) => store.setModel(e.currentTarget.value)}>
			{#each models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
		</select>
	</label>
	<div class="spacer"></div>
	<button type="button" onclick={() => store.tidy()}>Tidy</button>
	<button type="button" onclick={() => flow.fitView({ duration: 250 })}>Fit</button>
	<a class="account" href={resolve('/keys')} title={email}>Account</a>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-6);
		border-bottom: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		font: var(--text-sm);
	}
	.wordmark {
		font-weight: 600;
		color: inherit;
		text-decoration: none;
	}
	.model {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		color: var(--cy-ink-soft);
	}
	select,
	button {
		font: inherit;
		color: var(--cy-ink);
		background: var(--cy-paper);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-sm);
		padding: 4px var(--space-3);
	}
	button {
		cursor: pointer;
	}
	.spacer {
		flex: 1;
	}
	.account {
		color: inherit;
	}
</style>
```

`src/lib/components/canvas/Canvas.svelte`:

```svelte
<script lang="ts">
	import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow, useSvelteFlow, type Edge, type Node } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { panToLowerThird } from '$lib/canvas/viewport';
	import EmptyState from './EmptyState.svelte';
	import NodeCard from './NodeCard.svelte';

	const store = useCanvas();
	const flow = useSvelteFlow();
	const nodeTypes = { card: NodeCard };
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let container = $state<HTMLDivElement>();
	/** Nodes auto-follow has already framed once. */
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
			const prev = new Map(nodes.map((n) => [n.id, n]));
			nodes = graph.nodeIds.map((id) => {
				const { position } = graph.nodesById[id];
				const p = prev.get(id);
				if (p && p.position.x === position.x && p.position.y === position.y) return p;
				return p ? { ...p, position } : { id, type: 'card', position, data: {} };
			});
			edges = graph.nodeIds
				.filter((id) => graph.nodesById[id].parentId)
				.map((id) => ({ id: `e-${id}`, source: graph.nodesById[id].parentId!, target: id }));
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
</script>

<div class="flow" bind:this={container}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		initialViewport={store.viewport}
		nodesConnectable={false}
		elementsSelectable={false}
		deleteKey={null}
		zoomOnDoubleClick={false}
		minZoom={0.25}
		maxZoom={2}
		onlyRenderVisibleElements
		onmovestart={(event) => {
			if (event) store.following = null;
		}}
		onmoveend={(_event, viewport) => store.setViewport(viewport)}
		onnodedragstop={({ targetNode }) => {
			if (targetNode) store.moved(targetNode.id, targetNode.position);
		}}
	>
		<Background variant={BackgroundVariant.Lines} gap={24} patternColor="var(--cy-paper-edge)" bgColor="var(--cy-paper)" />
		<Controls showLock={false} />
		<MiniMap pannable zoomable bgColor="var(--cy-paper-deep)" />
	</SvelteFlow>
	{#if store.graph.nodeIds.length === 0}<EmptyState variant="empty" />{/if}
</div>

<style>
	.flow {
		position: relative;
		flex: 1;
		min-height: 0;
	}
</style>
```

`src/lib/components/canvas/CanvasApp.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { CanvasStore, provideCanvas } from '$lib/canvas/store.svelte';
	import type { NodeWire, ViewWire } from '$lib/canvas/node-wire';
	import { findModel, type ModelSpec } from '$lib/shared/models';
	import '$lib/styles/canvas-tokens.css';
	import Canvas from './Canvas.svelte';
	import Composer from './Composer.svelte';
	import TopBar from './TopBar.svelte';

	type Data = { nodes: NodeWire[]; view: ViewWire | null; email: string; models: readonly ModelSpec[]; defaultModelId: string };
	let { data }: { data: Data } = $props();

	function initialModel(): string {
		try {
			const saved = localStorage.getItem('nc:model');
			if (saved && findModel(saved)) return saved;
		} catch {
			// storage unavailable: use the default
		}
		return data.defaultModelId;
	}

	const store = new CanvasStore({ nodes: data.nodes, view: data.view, model: initialModel() });
	provideCanvas(store);
	onMount(() => {
		store.start();
		return () => store.dispose();
	});
</script>

<div class="app canvas-surface">
	<TopBar models={data.models} email={data.email} />
	<Canvas />
	<Composer />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--cy-paper);
	}
</style>
```

`src/routes/canvas/+page.svelte` (replace the placeholder):

```svelte
<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import CanvasApp from '$lib/components/canvas/CanvasApp.svelte';
	import EmptyState from '$lib/components/canvas/EmptyState.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>

{#if data.hasKey}
	<SvelteFlowProvider><CanvasApp {data} /></SvelteFlowProvider>
{:else}
	<EmptyState variant="no-key" />
{/if}
```

If `svelte-check` reports that `Background`/`MiniMap` take different colour prop names in 1.7.0, use the names its types report and keep the same token values; list the change in the report.

- [ ] **Step 5: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e`
Expected: PASS — canvas.spec 8 tests, all earlier suites. `pnpm check` 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/store.svelte.ts src/lib/styles/canvas-tokens.css src/lib/components/canvas src/routes/canvas/+page.svelte tests/e2e/canvas.spec.ts
git commit -m "feat(canvas): the Svelte Flow canvas — streaming cards, branching, composer, top bar

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 10: Banners, usage chip, starters — and the interaction checks

**Files:**
- Create: `src/lib/components/canvas/Banner.svelte`, `tests/e2e/interaction.spec.ts`, `tests/e2e/banners.spec.ts`
- Modify: `src/lib/components/canvas/CanvasApp.svelte`, `src/lib/components/canvas/TopBar.svelte`, `src/lib/components/canvas/EmptyState.svelte`, `src/lib/components/canvas/Canvas.svelte`

**Interfaces:**
- Consumes: `CanvasStore` (`online`, `rateLimit`, `limitReached`, `saveError`), `copy`, `formatDuration` (Task 3), Composer's `draft(value)` (Task 9).
- Produces: `Banner` (`{ tone: 'info' | 'warning' | 'danger'; children }`, `role="status"`); usage chip text `copy('limit.chip', { used, total })`; `EmptyState` variant `empty` gains `onpick?: (prompt: string) => void` and three starter buttons.

- [ ] **Step 1: Write the failing browser tests**

`tests/e2e/banners.spec.ts`:

```ts
import { expect, test } from './fixtures';

test('offline shows the banner and blocks sending; online clears it', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await context.setOffline(true);
	await expect(page.getByText("You're offline. Your canvas is here, but new messages will fail.")).toBeVisible();
	await page.getByLabel('Message').fill('hello');
	await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
	await context.setOffline(false);
	await expect(page.getByText("You're offline.")).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a failing save shows the banner, and a later success clears it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.route('**/api/nodes', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal_error","message":"x"}}' }));
	await page.getByLabel('Message').fill('save me');
	await page.getByLabel('Message').press('Enter');
	await expect(page.getByText("Some changes aren't saved yet.")).toBeVisible({ timeout: 10_000 });
	await page.unroute('**/api/nodes');
	await expect(page.getByText("Some changes aren't saved yet.")).toHaveCount(0, { timeout: 10_000 });
});

test('the usage chip counts this hour’s messages', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByLabel('Message').fill('count me');
	await page.getByLabel('Message').press('Enter');
	await expect(page.getByText('1 / 60 this hour')).toBeVisible();
});

test('the hourly limit blocks sending and says when it resets', async ({ page, signIn }) => {
	await signIn({ chatUsed: 60 });
	await page.goto('/canvas');
	await page.getByLabel('Message').fill('one too many');
	await page.getByLabel('Message').press('Enter');
	const card = page.locator('article[data-node-id]').last();
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText('You have reached the limit of 60');
	await expect(page.getByText(/You've used your 60 messages for this hour\. Resets in/)).toBeVisible();
	await expect(page.getByLabel('Message')).toHaveAttribute('placeholder', 'Hourly limit reached');
});

test('a starter prompt fills the composer', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByRole('button', { name: 'Name this product three different ways' }).click();
	await expect(page.getByLabel('Message')).toHaveValue('Name this product three different ways');
});
```

`tests/e2e/interaction.spec.ts` (the prototype's checks, on the real canvas):

```ts
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const cards = (page: Page) => page.locator('article[data-node-id]');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(page: Page, prompt: string, wait = true) {
	const before = await cards(page).count();
	await page.getByLabel('Message').fill(prompt);
	await page.getByLabel('Message').press('Enter');
	await expect(cards(page)).toHaveCount(before + 1);
	const card = cards(page).last();
	if (wait) await expect(card).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
	return (await card.getAttribute('data-node-id'))!;
}

async function viewport(page: Page) {
	const t = await page.locator('.svelte-flow__viewport').evaluate((el) => getComputedStyle(el).transform);
	const m = new DOMMatrixReadOnly(t);
	return { x: Math.round(m.e), y: Math.round(m.f), zoom: Math.round(m.a * 1000) / 1000 };
}

async function emptyCanvasPoint(page: Page) {
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

async function fit(page: Page) {
	await page.getByRole('button', { name: 'Fit' }).click();
	await sleep(400);
}

test('Branch binds the composer to the chosen node, every time', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const chain: string[] = [];
	for (const n of ['one', 'two', 'three', 'four']) chain.push(await send(page, `Chain ${n}`));
	for (let run = 0; run < 20; run++) {
		await fit(page);
		const ids = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')!));
		const pick = run % 2 === 0 ? chain[1] : ids[(run * 7) % (ids.length - 1)];
		await page.locator(`article[data-node-id="${pick}"] button[aria-label="Branch"]`).click();
		await expect(page.getByTestId('composer-target'), `run ${run}: after Branch`).toHaveAttribute('data-target-id', pick);
		const p = await emptyCanvasPoint(page);
		await page.mouse.click(p.x, p.y);
		await expect(page.getByTestId('composer-target'), `run ${run}: after canvas click`).toHaveAttribute('data-target-id', pick);
		const child = await send(page, `Fork ${run}`);
		await expect(page.locator(`article[data-node-id="${child}"]`), `run ${run}: parent`).toHaveAttribute('data-parent-id', pick);
	}
});

test('wheel over a card body scrolls it; over the canvas it zooms', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[long] long answer');
	const body = page.locator(`article[data-node-id="${id}"] [data-testid="card-body"]`);
	const before = await viewport(page);
	await body.hover();
	await page.mouse.wheel(0, 400);
	await sleep(300);
	expect(await body.evaluate((b) => b.scrollTop)).toBeGreaterThan(100);
	expect(await viewport(page)).toEqual(before);
	const p = await emptyCanvasPoint(page);
	await page.mouse.move(p.x, p.y);
	await page.mouse.wheel(0, 400);
	await sleep(300);
	expect((await viewport(page)).zoom).toBeLessThan(before.zoom);
});

test('a new node is framed and followed while it streams, until the user pans', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, '[slow][long] follow me', false);
	const inView = () =>
		page.evaluate((id) => {
			const card = document.querySelector(`[data-node-id="${id}"]`)!.getBoundingClientRect();
			const flow = document.querySelector('.svelte-flow')!.getBoundingClientRect();
			return card.top >= flow.top && card.bottom <= flow.bottom + 1;
		}, id);
	await sleep(800);
	expect(await inView()).toBe(true);
	await sleep(3000);
	expect(await inView()).toBe(true);
	const p = await emptyCanvasPoint(page);
	await page.mouse.move(p.x, p.y);
	await page.mouse.down();
	await page.mouse.move(p.x + 60, p.y + 120, { steps: 8 });
	await page.mouse.up();
	const afterPan = await viewport(page);
	await sleep(1500);
	expect(await viewport(page)).toEqual(afterPan);
});

test('dragging a card moves it and the position survives a reload', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const id = await send(page, 'drag me');
	const title = page.locator(`article[data-node-id="${id}"] .prompt`);
	const box = (await title.boundingBox())!;
	const before = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	await page.mouse.move(box.x + 20, box.y + box.height / 2);
	await page.mouse.down();
	// Real-mouse spacing: Svelte Flow skips the move that crosses its drag threshold.
	await page.mouse.move(box.x + 170, box.y + box.height / 2 + 90, { steps: 60 });
	await page.mouse.up();
	const moved = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	expect(moved.x - before.x).toBeGreaterThan(130);
	await expect.poll(async () => (await page.request.get('/canvas/__data.json')).text()).toContain('"manual"');
	await page.reload();
	const reloaded = (await page.locator(`.svelte-flow__node[data-id="${id}"]`).boundingBox())!;
	expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(4);
});
```

Run: `pnpm test:e2e`
Expected: FAIL — banners, chip and starters don't exist (the interaction tests may already pass; that's fine).

- [ ] **Step 2: Implement**

`src/lib/components/canvas/Banner.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tone, children }: { tone: 'info' | 'warning' | 'danger'; children: Snippet } = $props();
</script>

<div class="banner {tone}" role="status">{@render children()}</div>

<style>
	.banner {
		padding: var(--space-2) var(--space-6);
		font: var(--text-xs);
		border-bottom: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink-soft);
	}
	.warning {
		color: var(--warning);
	}
	.danger {
		color: var(--danger);
	}
</style>
```

In `CanvasApp.svelte`, import `Banner`, `copy` and `formatDuration`, keep a reference to the composer, and render the banners between `<TopBar>` and `<Canvas>`:

```svelte
<script lang="ts">
	// …existing imports…
	import { copy } from '$lib/canvas/copy';
	import { formatDuration } from '$lib/canvas/format';
	import Banner from './Banner.svelte';
	// …existing code…
	let composer = $state<ReturnType<typeof Composer>>();
</script>

<div class="app canvas-surface">
	<TopBar models={data.models} email={data.email} />
	{#if !store.online}<Banner tone="info">{copy('offline.banner')}</Banner>{/if}
	{#if store.limitReached && store.rateLimit}
		<Banner tone="warning">{copy('limit.banner', { total: store.rateLimit.limit, time: formatDuration(store.rateLimit.resetSeconds) })}</Banner>
	{/if}
	{#if store.saveError}<Banner tone="danger">{store.saveError}</Banner>{/if}
	<Canvas onpick={(prompt) => composer?.draft(prompt)} />
	<Composer bind:this={composer} />
</div>
```

In `Canvas.svelte`, accept the prop and pass it on:

```svelte
	let { onpick }: { onpick?: (prompt: string) => void } = $props();
	…
	{#if store.graph.nodeIds.length === 0}<EmptyState variant="empty" {onpick} />{/if}
```

In `EmptyState.svelte`, accept `onpick` and render the starters in the `empty` variant (and let the overlay receive clicks on them):

```svelte
<script lang="ts">
	import { resolve } from '$app/paths';
	import { copy } from '$lib/canvas/copy';

	let { variant, onpick }: { variant: 'no-key' | 'empty'; onpick?: (prompt: string) => void } = $props();
	const starters = [copy('starter.1'), copy('starter.2'), copy('starter.3')];
</script>
```

```svelte
	{:else}
		<h2>{copy('empty.headline')}</h2>
		<p>{copy('empty.sub')}</p>
		{#if onpick}
			<div class="starters">
				{#each starters as s (s)}<button type="button" onclick={() => onpick(s)}>{s}</button>{/each}
			</div>
		{/if}
	{/if}
```

```css
	.starters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: center;
		pointer-events: auto;
	}
	.starters button {
		font: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-full);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-lift);
		color: var(--cy-ink);
		cursor: pointer;
	}
```

In `TopBar.svelte`, import `copy` and show the chip before the spacer:

```svelte
	{#if store.rateLimit}
		<span class="chip">{copy('limit.chip', { used: store.rateLimit.limit - store.rateLimit.remaining, total: store.rateLimit.limit })}</span>
	{/if}
```

```css
	.chip {
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
```

- [ ] **Step 3: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS — banners 5, interaction 4, plus everything earlier.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/canvas tests/e2e/banners.spec.ts tests/e2e/interaction.spec.ts
git commit -m "feat(canvas): offline, limit and save-failed banners, the usage chip and starter prompts

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 11: The performance budget, and documentation

**Files:**
- Create: `tests/e2e/perf.spec.ts`
- Modify: `playwright.config.ts`, `package.json`, `AGENTS.md`, `README.md`

**Interfaces:**
- Consumes: seed server `nodes` option (Task 6); the canvas (Task 9).
- Produces: `pnpm test:perf` (`vite build && PERF=1 playwright test --project=perf`); a `perf` Playwright project that exists only when `PERF=1`.

- [ ] **Step 1: Config and script**

`playwright.config.ts` — replace the `projects` line with:

```ts
	projects: [
		{ name: 'desktop', testIgnore: /perf\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
		// Machine-dependent, so not part of CI: run with `pnpm test:perf`.
		...(process.env.PERF
			? [{ name: 'perf', testMatch: /perf\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }]
			: [])
	]
```

`package.json` scripts — add:

```json
"test:perf": "vite build && PERF=1 playwright test --project=perf"
```

- [ ] **Step 2: The spec** — `tests/e2e/perf.spec.ts`

```ts
import { expect, test } from './fixtures';

type Sample = { frames: number; p50: number; p95: number; max: number; longTasks: number; cardsMutated: number };

test('50 nodes, 3 concurrent streams, continuous pan: p95 ≤ 20 ms at 4× CPU', async ({ page, signIn }) => {
	await signIn({ nodes: 50 });
	await page.goto('/canvas');
	await expect(page.locator('article[data-node-id]').first()).toBeVisible();
	await page.getByRole('button', { name: 'Tidy' }).click();
	await page.getByRole('button', { name: 'Fit' }).click();
	await page.waitForTimeout(500);

	const visible = await page.locator('article[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')!));
	for (const q of [0.2, 0.5, 0.8]) {
		const id = visible[Math.floor(visible.length * q)];
		await page.locator(`article[data-node-id="${id}"] button[aria-label="Branch"]`).click();
		await page.getByLabel('Message').fill('[slow][long] concurrent');
		await page.getByLabel('Message').press('Enter');
		await expect(page.locator('article[data-status="streaming"]').last()).toContainText('Echo:', { timeout: 10_000 });
	}
	await page.getByRole('button', { name: 'Fit' }).click();
	await page.waitForTimeout(500);

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

	const measuring = page.evaluate(
		(ms) =>
			new Promise<Sample>((resolve) => {
				const deltas: number[] = [];
				const longs: number[] = [];
				const mutated = new Set<string>();
				const po = new PerformanceObserver((l) => longs.push(...l.getEntries().map((e) => e.duration)));
				po.observe({ type: 'longtask' });
				const mo = new MutationObserver((records) => {
					for (const r of records) {
						const el = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
						const card = el?.closest('[data-node-id]') as HTMLElement | null;
						if (card) mutated.add(card.dataset.nodeId!);
					}
				});
				mo.observe(document.querySelector('.svelte-flow__nodes')!, { subtree: true, childList: true, characterData: true });
				let last = performance.now();
				const end = last + ms;
				const tick = (t: number) => {
					deltas.push(t - last);
					last = t;
					if (t < end) return requestAnimationFrame(tick);
					po.disconnect();
					mo.disconnect();
					deltas.sort((a, b) => a - b);
					const at = (q: number) => Math.round(deltas[Math.floor(deltas.length * q)] * 10) / 10;
					resolve({ frames: deltas.length, p50: at(0.5), p95: at(0.95), max: Math.round(deltas.at(-1)! * 10) / 10, longTasks: longs.length, cardsMutated: mutated.size });
				};
				requestAnimationFrame(tick);
			}),
		5000
	);

	const box = (await page.locator('.svelte-flow__pane').boundingBox())!;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	for (let i = 0; i < 120; i++) {
		await page.mouse.move(cx + Math.sin(i / 8) * 90, cy + Math.cos(i / 11) * 50);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();

	const sample = await measuring;
	console.log(JSON.stringify(sample));
	expect(sample.cardsMutated, 'the streaming cards must be on screen').toBeGreaterThanOrEqual(3);
	expect(sample.p95).toBeLessThanOrEqual(20);
});
```

- [ ] **Step 3: Docs**

In `AGENTS.md`, under "Checks before handing work over", add after the code block:

```markdown
`pnpm test:perf` runs the canvas performance budget (spec §1.4: p95 frame
≤ 20 ms at 4× CPU, 50 nodes, 3 streams). It is machine-dependent, so it is
not in CI — run it before merging canvas changes.

Browser tests sign in through `tests/support/seed-server.ts` (test-only):
`signIn()` from `tests/e2e/fixtures.ts` creates a fresh user, key and
session, so tests never spend the real sign-up/sign-in limits.
```

In `README.md`, add `pnpm test:perf` to the Checks block with a one-line comment: `# canvas performance budget (local only)`.

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e && pnpm test:perf`
Expected: PASS. Record the perf sample line in the report. If p95 exceeds 20 ms, report DONE_WITH_CONCERNS with the sample — do not loosen the threshold.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts package.json tests/e2e/perf.spec.ts AGENTS.md README.md
git commit -m "test(perf): the canvas frame-time budget as a local-only Playwright project

Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage (Plan 2's share):** §4 canvas in-scope items — send, stream, thinking, stop, branch, markdown, drag, Tidy, zoom/fit (Controls + Fit), minimap, auto-follow, model selector, usage chip, rate-limit/offline/save-failed banners, empty state → Tasks 4, 9, 10. §5 schema use + deferrable FK → Task 7. §6 `PUT /api/nodes`, `DELETE /api/nodes/:id`, `POST /api/chat`, canvas load → Tasks 6, 7. §7 key decrypted only in `/api/chat`, tenant isolation, logging → Tasks 6, 7. §8 store/streams/saver split, components, invariant → Tasks 8, 9, 10. §9 unit, database and browser tests incl. branch ×20, wheel, follow, drag, perf budget, journey, save-failed banner, fake Anthropic → Tasks 5–11.
- **Deferred to Plan 3 by design:** retry / continue, delete + undo (the `DELETE` route exists and is tested here), keyboard navigation and the shortcuts sheet, resize and collapse controls (fields are carried and saved), focus-path highlighting, transcript view, desktop-only notice.
- **Deliberate deviations from the spec, for review:** `model_declined` is a new error code (refusals were matched by message text before); the composite parent FK becomes `deferrable initially deferred` (migration 0002); the performance budget runs locally (`pnpm test:perf`), not in CI; browser tests sign in through a test-only seed server rather than the UI.
- **Names used across tasks:** `NodeErrorCode`, `ChatStreamEvent`, `ModelSpec`, `findModel`, `NodeWire`, `ViewWire`, `toWire`, `fromWire`, `ApiCallError`, `apiFetch`, `streamChat` (browser, Task 3) vs `streamChat` (server, Task 5 — different modules), `presentError`, `toNodeError`, `TIMEOUT_ERROR`, `copy`, `formatDuration`, `parseMarkdown`, `parseChatBody`, `parseSaveBody`, `saveNodes`, `deleteNode`, `loadCanvas`, `isUuid`, `StreamQueue`, `Outcome`, `Saver`, `SaveBody`, `CanvasStore`, `provideCanvas`, `useCanvas`, `signIn` fixture, `anthropicRequests`, `resetAnthropic` — each defined once, in the task named in its Interfaces block.
