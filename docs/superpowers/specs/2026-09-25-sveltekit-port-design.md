# node-canvas: SvelteKit port — design

- **Date:** 2026-09-25
- **Status:** approved in conversation, pending written review
- **Replaces:** `njmrmd/node-canvas-chat` (Next.js 16 / React 19), built by the Paperclip agent team
- **Evidence:** Svelte Flow spike, branch `spike/svelte-flow` (`239a324`), findings in `spike/svelte-flow/README.md`

## 1. Goal

Rebuild Node Canvas Chat — a chat app where a conversation is a graph of
cards on a pannable canvas, on the user's own Anthropic key — as a
**desktop-only SvelteKit app** in a new repository, with the same feature set
minus phone support, and with the complexity the React version accumulated
removed rather than carried over.

### Success criteria

1. Feature parity with the current canvas on desktop (§4), verified by the
   browser tests in §8.
2. Branching from any card binds the composer to that card, every time: the
   20-run branch test passes on every CI run (the DES-142 class of bug cannot
   recur because nothing but an explicit action changes the target).
3. A canvas of any size saves: no document-size ceiling; a save failure is
   visible, never silent.
4. At 50 nodes with 3 replies streaming and the user panning, p95 frame time
   ≤ 20 ms at 4× CPU throttle, and only the streaming cards touch the DOM.
5. Every CI job blocks merging; none is red by design.
6. The security properties in §7 hold, each with a test.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) | The React version's main bug classes (stale closures, ref mirrors, listener churn from effect dependencies) do not exist in runes. Owner preference. |
| Canvas | `@xyflow/svelte` 1.x | Spike: all 9 checks pass; replaces ~3,300 lines of hand-rolled canvas with ~500. |
| Devices | Desktop only | Below ~900 px wide, show a "built for desktop" notice. No touch gestures, no mobile layouts. |
| Repository | New repo `node-canvas`, new Vercel project | Clean start; the current repo is archived at cutover. |
| Data | Fresh Neon database, fresh schema | No real users to migrate; frees the per-node schema. |
| Saving | Per-node upsert of changed nodes (approach A) | Removes the 4 MB ceiling for good; `/api/chat` stays a stateless relay. |
| Styling | Svelte `<style>` blocks + CSS custom-property tokens | One styling system; Tailwind dropped. Existing tokens (incl. cyanotype canvas) carried over. |
| Provider | Anthropic only, no provider registry | One provider; the registry abstraction had a single implementation. |

## 3. Stack

- SvelteKit 2, Svelte 5, TypeScript, Vite; `@sveltejs/adapter-vercel` (Node runtime).
- `@xyflow/svelte` 1.x for the canvas.
- `pg` for Postgres; `@anthropic-ai/sdk` server-side only.
- `node:test` + `tsx` for unit and database tests; `@playwright/test` pinned to an exact version for browser tests.
- pnpm; Node 22+.

## 4. Scope

### In

- **Landing page** `/` with a route into sign-up (and the product image / OG card).
- **Accounts:** sign up, sign in, sign out, delete account. No password reset; the copy says so (carried from current `auth-form.tsx` / `key-manager.tsx`, including the two strings ported in `6bf3be7`).
- **Key management** `/keys`: connect (validated against Anthropic before storing), replace, remove; masked last-four display.
- **Canvas** `/canvas`:
  - send, streamed reply, thinking text, stop, retry / continue on error or interruption;
  - branch from any finished card;
  - markdown in replies;
  - delete a card and its subtree, with an undo toast (Cmd/Ctrl+Z);
  - drag cards; Tidy; zoom in/out, fit, 100%; minimap;
  - auto-follow of the newest node while it streams, released by a manual pan;
  - model selector and usage chip; rate-limit, offline and save-failed banners; empty state;
  - **transcript view** (T): the root → target path as plain text;
  - **keyboard navigation:** arrows / Home / End between cards, Enter binds the composer to the focused card, Alt+arrows nudge, shortcuts sheet (?), plus every shortcut in the current `shortcuts-sheet.tsx`;
  - **card size controls:** manual resize (drag handle and Cmd/Ctrl+Alt+arrows), body collapse to one line, subtree collapse with a hidden-count chip;
  - **focus-path highlighting:** cards off the root → target path are dimmed.
- **Health** `GET /api/health`.

### Out

- Phones, tablets and touch gestures (long-press drag, swipe, mobile top bar, mobile action bar).
- The composer's skeleton preview of the next card (the DES-142 cause; also removes the TES-110 reflow-on-resize).
- Dev-only harness pages, one-off QA scripts, the hand-rolled CDP driver.
- Deploy-provenance tooling (`deploy.sh`, drift check); Vercel's Git integration covers it.
- Nightly real-key e2e against production.
- Password reset, multiple providers, collaboration, export.

## 5. Data model

A single initial migration. All ids are `uuid`. All timestamps `timestamptz`.

```sql
create extension if not exists citext;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  password_hash text not null,                 -- scrypt verifier string
  created_at    timestamptz not null default now()
);

create table sessions (
  token_hash  bytea primary key,               -- sha256(cookie token)
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index sessions_user_id_idx on sessions(user_id);

create table provider_keys (
  user_id     uuid primary key references users(id) on delete cascade,
  ciphertext  bytea not null,
  iv          bytea not null,
  tag         bytea not null,
  last4       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table nodes (
  id              uuid primary key,              -- minted by the browser
  user_id         uuid not null references users(id) on delete cascade,
  parent_id       uuid,
  prompt          text not null,
  response        text not null default '',
  thinking        text not null default '',
  status          text not null check (status in ('draft','streaming','complete','interrupted','error')),
  error           jsonb,
  usage           jsonb,
  model           text,
  x               real not null,
  y               real not null,
  position_mode   text not null check (position_mode in ('auto','manual')),
  width           real,
  height          real,
  collapsed       boolean not null default false,
  body_collapsed  boolean not null default false,
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  unique (id, user_id),
  -- A node can only hang off a node owned by the same user.
  foreign key (parent_id, user_id) references nodes(id, user_id) on delete cascade
);
create index nodes_user_id_idx on nodes(user_id);
create index nodes_parent_id_idx on nodes(parent_id);

create table canvas_view (
  user_id           uuid primary key references users(id) on delete cascade,
  viewport          jsonb not null,             -- { x, y, zoom }
  target_node_id    uuid references nodes(id) on delete set null,
  updated_at        timestamptz not null default now()
);

create table rate_limits (
  bucket        text not null,
  subject       text not null,
  window_start  timestamptz not null,
  count         integer not null,
  primary key (bucket, subject, window_start)
);
```

Housekeeping, in the write paths that already touch these tables (no cron):
expired `sessions` rows are deleted on sign-in; `rate_limits` rows older than
their window are deleted when a new window row is written.

## 6. Server surface

### Hooks (`hooks.server.ts`)

- Resolve the session cookie → `event.locals.user` (one query).
- `/canvas` and `/keys` redirect to `/sign-in?next=…` when signed out; `next` goes through the carried-over `safeNextPath`.
- Security headers on every response (§7). CSP through `kit.csp` (SvelteKit's built-in nonce/hash handling).
- `handleError`: log route + error message only; return a generic message.

### Form actions

`/sign-up`, `/sign-in`, `/keys` (connect, remove, sign out, delete account).
Cross-site form posts are rejected by SvelteKit's `csrf.checkOrigin` (on by
default). Validation errors return `fail(400, { fields })`; the pages render
them with the carried-over copy.

### Canvas load

`/canvas/+page.server.ts` `load` returns `{ view, hasKey, models, defaultModelId, email }` for
the signed-in user. The nodes are not in the page data: the page fetches them from
`GET /api/nodes` before it builds the canvas — pages in creation order of at most 3 MiB of text
(or one larger node alone) — so ordinary JSON escaping keeps every page well under Vercel's 4.5 MB
cap on a buffered response; only text crafted to escape heavily could exceed it (Plan 3). The page
component itself renders client-side only (`ssr = false`).

### JSON routes

The write routes require a session and `assertSameOrigin`, and `Content-Type: application/json` when they take a body; the read route requires a session.

- **`GET /api/nodes[?after=<cursor>]`** — one page of the canvas load: `{ nodes: NodeWire[], next: string | null }`, in `(created_at, id)` order. The cursor is the last node's exact `created_at` and id.
- **`PUT /api/nodes`** — body `{ upserts: NodeWire[], view?: ViewWire }`.
  - Body cap 4 MB (under Vercel's 4.5 MB request limit; one node at the per-field caps below can reach ~2.7 MB of UTF-8); at most 200 nodes per call. The client splits larger saves.
  - Each node is shape-checked; `prompt` ≤ `MAX_MESSAGE_CHARS`; `response`/`thinking` ≤ 400,000 chars; numbers finite; enums valid.
  - Upsert: `insert … on conflict (id) do update … where nodes.user_id = excluded.user_id` — a node id belonging to another user is never overwritten; such rows are reported back as rejected.
  - Parent integrity is enforced by the composite foreign key; a batch is written parents-first.
  - Rate limit `nodeWrite`: 120 per user per minute.
  - Returns `{ rejected: string[] }`.
- **`DELETE /api/nodes/:id`** — deletes the node; the cascade removes its subtree. Scoped by `user_id`. Undo is client-side: the browser keeps the removed subtree and re-upserts it, parents first.
- **`POST /api/chat`** — the current stateless relay, unchanged in behaviour: session, rate limit (`chat`: 60 per user per hour), body cap 2 MB, message/role/model allowlists, decrypt key, stream SSE frames (`data: <ChatStreamEvent>\n\n`), abort upstream when the client disconnects. The model allowlist is refreshed against Anthropic's current model list at build time.
- **`GET /api/health`** — `{ ok, commit }` from `VERCEL_GIT_COMMIT_SHA`.

### Carried-over rate limits

| Policy | Limit |
|---|---|
| `signUp` | 5 per IP per hour |
| `signIn` | 10 per IP per 15 min |
| `keyWrite` | 20 per user per hour |
| `chat` | 60 per user per hour |
| `nodeWrite` | 120 per user per minute |

## 7. Security

Carried over, not simplified. Each item has a unit or database test.

- **Provider key:** lives only in `provider_keys.ciphertext`; AES-256-GCM under `KEY_VAULT_ENCRYPTION_KEY` (server env only; different values for Preview and Production); AAD `"<userId>:anthropic"` so a moved row fails its tag check; decrypted only in `/api/chat` after the session check; never returned to the browser. **A database dump yields ciphertext, IV, tag and last four characters — nothing usable without the server key.**
- **Passwords:** scrypt `N=32768, r=8, p=1`; dummy verify for unknown emails; constant-time compare; minimum 10 characters.
- **Sessions:** 32 random bytes; only SHA-256 stored; cookie `httpOnly; Secure; SameSite=Lax`; 30-day expiry; sign-out and account deletion delete the rows.
- **Cross-site requests:** SvelteKit `checkOrigin` for forms; `assertSameOrigin` on every state-changing API route, and a JSON content type wherever a body is read.
- **Tenant isolation:** every node, view and key query is scoped by `user_id`; the composite FK prevents cross-user parent links; the upsert cannot overwrite another user's row.
- **Headers:** CSP (`kit.csp`, no `unsafe-inline` scripts), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, restrictive `Permissions-Policy`.
- **Database TLS:** `db-tls.mjs` (carried) — `sslmode=require|prefer|verify-ca` rewritten to `verify-full`; no-sslmode URLs get verified TLS.
- **Logging:** never keys, tokens, prompts, responses or emails.

## 8. Frontend architecture

### Routes

| Route | Contents |
|---|---|
| `/` | Landing page |
| `/sign-up`, `/sign-in` | Auth forms (form actions) |
| `/keys` | Key manager, sign out, delete account |
| `/canvas` | The canvas app (client-rendered) |

A root layout renders `DesktopOnlyNotice` instead of the page below ~900 px width.

### Canvas state — three modules

- **`store.svelte.ts`** — class `CanvasStore`:
  - `graph` (`$state.raw<ConversationGraph>`, immutable updates through the carried `graph.ts`), `target`, `following`, `focusedId` (keyboard focus), `undo` (last deleted subtree + prior target), `layoutVersion`.
  - Actions: `send`, `branch`, `newConversation`, `stop`, `retry`, `continueReply`, `remove`, `undoRemove`, `moved`, `resized`, `toggleCollapsed`, `toggleBodyCollapsed`, `tidy`, `nudge`.
  - **Invariant:** `target` changes only through Branch (button or `B`), sending (Continue and Regenerate included), New conversation, Enter on a focused card, and deleting the target or an ancestor of it (then `null`), which Undo reverses if nothing else has changed it since. A pane or card click never changes it.
  - Layout through the carried `layout.ts`: `autoPlaceOnCreate` + `reflowChildrenOnCreate` on send; `reflowChildrenOnCreate` once on resize end; `tidyLayout` on Tidy. Heights from Svelte Flow's measured sizes.
  - Plan 3 also gave it: `focusedId` (keyboard focus, never the target), `focusPath` (on by default, `F`), `structure` (children and the hidden set, rebuilt per `layoutVersion`), `pathIds`, `transcriptOpen`, `shortcutsOpen`; and `regenerate`, `bindComposer`, `branchFromCard`, `focusCard`, `resizeBy`.
- **`streams.ts`** — up to 3 concurrent streams, FIFO queue beyond that, 60 s first-token watchdog (the relay sends a `ping` at `message_start`, and the first frame stops the watchdog, so a long thinking phase never reads as "Timed out"), `AbortController` per node, events applied through `graph.ts` (`appendText`, `completeNode`, `failNode`, `interruptNode`). Uses the carried `stream.ts` client.
- **`saver.ts`** — a set of dirty node ids plus a dirty-view flag; flushes every 1.5 s, on `visibilitychange → hidden`, and on `pagehide` (`fetch` with `keepalive`, which browsers cap at 64 KB per request — so the unload flush sends the streaming node and view first and anything beyond the cap is best-effort; the regular 1.5 s flush is what guarantees saving); splits into ≤ 200-node / ≤ 4 MB batches, parents first; on any non-network failure raises `saveError` (banner) and keeps the ids dirty; offline → waits for `online`. Deletes are queued (`markDeleted`) and sent after the flush's saves; an Undo before they go cancels them (`cancelDeletion`), and the unload save sends any still pending with `keepalive`.

### Components

- `Canvas.svelte` — `SvelteFlow` (nodes not selectable/connectable, its own keyboard handling off — `nodesFocusable`/`edgesFocusable={false}`, `disableKeyboardA11y`, `deleteKey={[]}` — `zoomOnDoubleClick={false}`, `onlyRenderVisibleElements`), graph → flow node sync on `layoutVersion`, auto-follow, `MiniMap`, `Controls`, `Background` (cyanotype tokens), one `svelte:window` keydown handler for all shortcuts.
- `NodeCard.svelte` — header (title, status, Stop, Branch, body and subtree collapse, Delete), a footer with Retry, Continue and Regenerate where they apply, `Markdown.svelte` body with `nowheel`, thinking disclosure, error state, `NodeResizeControl`, hidden-count chip for collapsed subtrees, dimmed class when off the focus path.
- `Composer.svelte` — target badge (the store's `target`, nothing derived), Enter sends, Shift+Enter newline, disabled reason when the target has no answer yet.
- `TopBar.svelte` — wordmark, model selector, usage chip, Tidy, Fit, Focus path, Linear view, `?` (the shortcuts sheet), account link.
- `LinearView.svelte` (the linear view), `ShortcutsSheet.svelte`, `UndoToast.svelte`, `Banner.svelte` (offline / rate limit / save failed), `EmptyState.svelte`, `DesktopOnlyNotice.svelte`.
- `Markdown.svelte` — port of `markdown.tsx`; same rules; its tests carry over.

### Carried over (copied, then imports adjusted)

`conversation/graph.ts`, `canvas/layout.ts`, `canvas/viewport.ts`,
`conversation/stream.ts`, `chat-limits.ts`, `canvas/copy.ts`,
`crypto/vault.ts`, `crypto/password.ts`, `auth/csrf.ts`, `auth/next-path.ts`,
`rate-limit.ts`, `db-tls.mjs`, `providers/anthropic.ts` (minus the TES-59
diagnostic logging), `canvas-tokens.css`, and their `*.test.ts` files.

## 9. Testing

- **Unit** (`node:test`): the carried suites, plus new suites for `saver.ts` (batching, flush timing, splitting, failure → banner, offline), `streams.ts` (concurrency cap, queue, watchdog, stop), `PUT /api/nodes` validation, rate limiting, sessions, and the key store/load round trip.
- **Database** (`node:test` against a real Postgres; GitHub Actions service container in CI, local Docker or Neon branch in dev): migration applies cleanly; cross-user upsert is rejected; cross-user parent link is refused by the FK; node delete cascades the subtree; account delete removes everything; expired sessions and stale rate-limit rows are swept.
- **Browser** (Playwright, pinned, desktop Chromium 1440×900):
  - from the spike: branch 20× off an older node with a bare-canvas click before each send; wheel over a card body scrolls it; follow-newest + release on pan; drag writes back; 50-node / 3-stream performance budget (§1.4);
  - the journey: sign up → connect key → first reply → branch → reload → canvas restored;
  - delete + undo; transcript view; keyboard navigation; resize; collapse; focus-path dimming; save-failed banner (route intercepted).
- **No real Anthropic calls in CI.** A fake Anthropic server (Messages streaming format) runs in the test job; the SDK is pointed at it with `ANTHROPIC_BASE_URL`. `/api/chat` runs for real, with a test key.

## 10. CI and deployment

- **CI** — one workflow on pull requests and pushes to `main`: `svelte-check`, lint, unit, database, build, browser. All required.
- **Vercel** — Git integration; preview per PR; production from `main`; repo auto-merge on.
- **Neon** — via the Vercel integration. Preview and Production use separate `KEY_VAULT_ENCRYPTION_KEY` values. Per-preview database branches: off initially.
- **Environment** — `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (migrations), `KEY_VAULT_ENCRYPTION_KEY`, optional `APP_ORIGIN`.
- **Cutover** — once §1's criteria pass on `node-canvas-theta.vercel.app`: move any custom domain to the new project, archive `njmrmd/node-canvas-chat`. No data migration (fresh database).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Svelte Flow drag skips the threshold-crossing move (~2 px) | Accepted; noted in the spike. Revisit if it is visible. |
| Svelte 5 is newer; AI tools sometimes emit Svelte 4 syntax | `AGENTS.md` in the new repo pins conventions (runes only, no stores API, `onclick` not `on:click`). |
| Keyboard navigation and resize interplay with Svelte Flow's own key/pointer handling | Svelte Flow's keyboard handling off (`deleteKey={[]}`, `nodesFocusable={false}`, `disableKeyboardA11y`), `nodrag`/`nowheel` classes, one window key handler; covered by browser tests. |
| A closed tab mid-reply loses up to ~1.5 s of text | Accepted (approach A); `pagehide` flush narrows it. Orphaned `streaming` nodes settle to `interrupted` on load (carried `settleOrphanedStreams`). |
| Model ids drift | Allowlist refreshed at build time from Anthropic's model list; the test pinning ids to the registry is dropped. |

## 12. Open items

None blocking. Decided defaults the plan may revisit: the 900 px desktop
threshold; 1.5 s save interval; per-preview Neon branches off.
