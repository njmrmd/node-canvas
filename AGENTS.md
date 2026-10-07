# node-canvas — notes for agents

A desktop-only chat app where a conversation is a graph of cards on a canvas,
on the user's own Anthropic key. SvelteKit 2, Svelte 5, Svelte Flow.
Design: `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`.

## Svelte conventions

- Runes only: `$props`, `$state`, `$derived`, `$effect`. No `svelte/store`, no `export let`.
- Event attributes: `onclick={…}`, never `on:click`.
- Styles in the component's `<style>` block, using tokens from `src/lib/styles/tokens.css`. No Tailwind.

## Server code

- `src/lib/server/**` and `src/lib/auth/**` use relative imports and `process.env`,
  never `$app/*` or `$env/*`, so `node:test` can load them.
- Every node/key/view query is scoped by `user_id`.
- Never log keys, tokens, passwords, prompts, responses or emails.

## Canvas conventions

- Canvas state lives in `src/lib/canvas/store.svelte.ts`; the deciding logic lives in the
  framework-free modules beside it (`graph.ts`, `navigation.ts`, `shortcuts.ts`, `saver.ts`, …),
  each with `node:test` tests. Put new logic there, not in components.
- The composer target changes only through Branch (button or `B`), sending (Continue and
  Regenerate included), New conversation, Enter on a focused card, and deleting the target or an
  ancestor of it (Undo puts it back if nothing else has changed it since). Nothing else assigns
  `store.target` once the store is built.
- Every canvas shortcut goes through `resolveShortcut` (`src/lib/canvas/shortcuts.ts`) and the one
  `svelte:window` handler in `Canvas.svelte`; only Esc closing the linear view (decided in that
  handler) and the composer's own Enter and Esc (in its textarea) skip `resolveShortcut`. A new
  shortcut gets its row in `SHORTCUT_ROWS` too, so the `?` sheet never lists a key that does
  nothing, or misses one `resolveShortcut` handles. Then update the row count that
  `shortcuts.test.ts` and the sheet test in `tests/e2e/focus.spec.ts` pin.
- The canvas loads its nodes from `GET /api/nodes`, page by page; the page data carries the view,
  not the nodes. Never put node text back into a `load`: Vercel caps a buffered function response
  at 4.5 MB.

## Checks before handing work over

```bash
pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e
```

All of them gate CI. `pnpm test:db` starts its own Postgres (embedded) unless
`TEST_DATABASE_URL` is set. `pnpm test:e2e` builds, then runs against
`vite preview` with a fresh database and a fake Anthropic API — no real key.

`pnpm test:perf` runs the canvas performance budget (spec §1.4: p95 frame
≤ 20 ms at 4× CPU, 50 nodes, 3 streams). It is machine-dependent, so it is
not in CI — run it before merging canvas changes.

Browser tests sign in through `tests/support/seed-server.ts` (test-only):
`signIn()` from `tests/e2e/fixtures.ts` creates a fresh user, key and
session, so tests never spend the real sign-up/sign-in limits.

`signIn()` talks to a loopback seed server that only the local rig starts, so specs that use it
cannot run against a deployed server.

## Commits

Small, conventional. If a change touches auth, key storage or the provider
route, say where the key lives, what encrypts it, and what an attacker with
database read access would get.
