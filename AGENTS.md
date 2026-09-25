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

## Checks before handing work over

```bash
pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e
```

All of them gate CI. `pnpm test:db` starts its own Postgres (embedded) unless
`TEST_DATABASE_URL` is set. `pnpm test:e2e` builds, then runs against
`vite preview` with a fresh database and a fake Anthropic API — no real key.

## Commits

Small, conventional. If a change touches auth, key storage or the provider
route, say where the key lives, what encrypts it, and what an attacker with
database read access would get.
