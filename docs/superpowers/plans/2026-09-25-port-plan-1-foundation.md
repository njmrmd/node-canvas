# node-canvas Plan 1 — Foundation and accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `node-canvas` SvelteKit repository where a stranger can create an account, connect an Anthropic key (validated, encrypted at rest), sign out and in, and delete the account — with CI gating every change and a real Postgres behind the tests.

**Architecture:** SvelteKit 2 / Svelte 5 on Vercel's Node runtime. Server code lives in `src/lib/server/` with **relative imports only and no SvelteKit virtual modules** (`$app/*`, `$env/*`), so `node:test` can load it directly; routes import it through `$lib/server/...`. Accounts use SvelteKit form actions (built-in cross-site check); JSON helpers exist for Plan 2's routes. Postgres via `pg`; tests use a real Postgres (`embedded-postgres` locally, a service container in CI).

**Tech Stack:** SvelteKit 2.70, Svelte 5.57 (runes), TypeScript, `@sveltejs/adapter-vercel` 6, `pg` 8.23, `@anthropic-ai/sdk` 0.128, `node:test` + `tsx` 4.23, `embedded-postgres` 18.4.0-beta.17, `@playwright/test` 1.63.0 (exact), ESLint (sv add-on), pnpm 9, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md` (sections 3, 5, 6, 7, 9, 10). This is plan 1 of 4: (1) foundation & accounts, (2) canvas core, (3) canvas features, (4) landing page & cutover.

## Global Constraints

- New repo at `/Users/nicholas/Workspace/node-canvas`, GitHub `njmrmd/node-canvas`, **public, MIT** (matching `njmrmd/node-canvas-chat`).
- Carried code comes from the old repo at commit `c215512` (current `main` of `/Users/nicholas/Workspace/node-canvas-chat`), never from a working tree.
- Desktop only. No touch or mobile work in any task.
- Svelte 5 runes only: `$props`, `$state`, `$derived`, `$effect`; event attributes (`onclick`), never `on:click`; no `svelte/store`.
- Styling: component `<style>` blocks + CSS custom properties from `src/lib/styles/tokens.css`. **No Tailwind.**
- `src/lib/server/**` and `src/lib/auth/**`: relative imports only; must not import `$app/*` or `$env/*`; read configuration from `process.env`.
- Unit tests: `*.test.ts` (no database). Database tests: `*.dbtest.ts`. Browser tests: `tests/e2e/*.spec.ts`.
- Provider key: stored only in `provider_keys.ciphertext`; AES-256-GCM under `KEY_VAULT_ENCRYPTION_KEY`; AAD `"<userId>:anthropic"`; never returned to the browser (last four characters only).
- Passwords: scrypt `N=32768, r=8, p=1`; min 10, max 200 characters. Sessions: 32 random bytes, only SHA-256 stored, 30-day expiry, cookie `httpOnly`, `SameSite=Lax`, `Secure` (SvelteKit default; relaxed only on `http://localhost`).
- Rate limits: `signUp` 5/IP/hour · `signIn` 10/IP/15 min · `keyWrite` 20/user/hour · `chat` 60/user/hour · `nodeWrite` 120/user/minute.
- Never log keys, tokens, passwords, prompts, responses or emails.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Conventional commit prefixes. Any commit touching auth, key storage or the provider says where the key lives, what encrypts it, and what a database read yields.
- Before handing over any task: `pnpm check && pnpm lint && pnpm test` pass (plus `pnpm test:db` / `pnpm test:e2e` once they exist).

### Carrying a file from the old repo

Every task that carries code defines this helper in its shell first:

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
```

## File structure (end of Plan 1)

```
node-canvas/
├── .github/workflows/ci.yml          CI: check, lint, unit, db, build, e2e — all required
├── AGENTS.md  README.md  LICENSE  .env.example  .gitignore  .npmrc
├── package.json  pnpm-lock.yaml  tsconfig.json  eslint.config.js  vite.config.ts
├── playwright.config.ts
├── db/migrations/0001_init.sql       full schema (spec §5)
├── docs/superpowers/specs/…          the spec (copied)   docs/superpowers/plans/… this plan
├── scripts/
│   ├── migrate.mjs                   migration runner (CLI + exported migrate())
│   └── test-db.mjs                   runs *.dbtest.ts against embedded or CI Postgres
├── tests/
│   ├── support/test-db.ts            freshDatabase() for db tests
│   ├── support/fake-anthropic.ts     fake Anthropic API (GET /v1/models)
│   ├── support/e2e-server.ts         Postgres + fake Anthropic + vite preview for Playwright
│   └── e2e/accounts.spec.ts
└── src/
    ├── app.d.ts  app.html  hooks.server.ts
    ├── lib/
    │   ├── auth/credentials.ts (+test)   email/password rules (carried, shared)
    │   ├── auth/next-path.ts (+test)     safe redirect targets (carried, shared)
    │   ├── copy/auth.ts                  every auth/keys screen string
    │   ├── styles/tokens.css  styles/base.css
    │   ├── components/{Shell,TextField,Button,Alert,AuthForm}.svelte
    │   └── server/
    │       ├── api-error.ts (+test)      ApiError, codes, JSON envelope, withRoute, readJsonBody
    │       ├── db.ts  db-tls.mjs (+test) pool, query helpers, verified TLS
    │       ├── schema.dbtest.ts          FK / cascade / isolation checks
    │       ├── crypto/vault.ts (+test)   AES-256-GCM key vault (carried)
    │       ├── crypto/password.ts (+test) scrypt (carried)
    │       ├── auth/csrf.ts (+test)      assertSameOrigin for JSON routes (carried)
    │       ├── auth/session.ts (+dbtest) session rows
    │       ├── auth/session-cookie.ts (+test) cookie options
    │       ├── rate-limit.ts (+dbtest)   fixed-window limits + housekeeping
    │       ├── keys.ts (+dbtest)         the one provider key per user
    │       ├── anthropic.ts (+test)      client + key validation (chat in Plan 2)
    │       ├── form.ts                   str(), rateLimitMessage() for actions
    │       └── guard.ts (+test)          protected paths, security headers
    └── routes/
        ├── +layout.svelte  +layout.server.ts  +page.svelte (placeholder landing)
        ├── sign-up/  sign-in/  keys/  canvas/ (placeholder)
        └── api/health/+server.ts
```

---

### Task 1: Scaffold the repository

**Files:**
- Create: the whole scaffold via `sv create`, then `vite.config.ts`, `package.json` (scripts, deps), `AGENTS.md`, `README.md`, `LICENSE`, `.env.example`, `.gitignore` (append), `src/routes/api/health/+server.ts`, `docs/superpowers/specs/2026-09-25-sveltekit-port-design.md`, `docs/superpowers/plans/2026-09-25-port-plan-1-foundation.md`

**Interfaces:**
- Produces: `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` scripts; `GET /api/health` → `{ ok: true, commit: string }`.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/nicholas/Workspace
npx -y sv@latest create node-canvas --template minimal --types ts --add eslint "sveltekit-adapter=adapter:vercel" --install pnpm
cd node-canvas && git init -q && git branch -m main
ls
```

Expected: `package.json`, `vite.config.ts`, `eslint.config.js`, `src/`, with `@sveltejs/adapter-vercel` in `devDependencies`. If the adapter add-on syntax is rejected, run `pnpm add -D @sveltejs/adapter-vercel` and use the `vite.config.ts` below regardless.

- [ ] **Step 2: Dependencies**

```bash
pnpm add pg@8.23.0 @anthropic-ai/sdk@0.128.0
pnpm add -D tsx@4.23.15 @types/pg@8 @types/node@22 embedded-postgres@18.4.0-beta.17 @playwright/test@1.63.0
```

Then edit `package.json`: set `"packageManager": "pnpm@9.15.4"`, `"license": "MIT"`, `"engines": { "node": ">=22.9" }`, and replace `"scripts"` with:

```json
"scripts": {
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "prepare": "svelte-kit sync || echo ''",
  "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
  "lint": "eslint .",
  "test": "node --import tsx --test \"src/**/*.test.ts\"",
  "test:db": "node scripts/test-db.mjs",
  "test:e2e": "vite build && playwright test",
  "db:migrate": "node --env-file-if-exists=.env scripts/migrate.mjs"
}
```

Make sure `@playwright/test` is pinned without a caret (`"@playwright/test": "1.63.0"`).

- [ ] **Step 3: `vite.config.ts`**

```ts
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Server code reads process.env (so node:test can load it). Vite only fills
	// import.meta.env from .env, so copy .env into process.env for dev/preview.
	// Real environment variables always win.
	for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
		process.env[key] ??= value;
	}

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				csp: {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'],
						'img-src': ['self', 'data:', 'blob:'],
						'font-src': ['self'],
						'connect-src': ['self'],
						'object-src': ['none'],
						'base-uri': ['self'],
						'form-action': ['self'],
						'frame-ancestors': ['none']
					}
				}
			})
		]
	};
});
```

(`csrf` is left at SvelteKit's default: cross-site form posts are rejected in production builds.)

- [ ] **Step 4: Health route**

`src/routes/api/health/+server.ts`:

```ts
import { json } from '@sveltejs/kit';

export const GET = () =>
	json(
		{ ok: true, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local' },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
```

- [ ] **Step 5: Repo files**

`.env.example`:

```bash
# Copy to .env for local development. Never commit a filled-in copy.
# On Vercel these live in Project → Settings → Environment Variables, with
# different KEY_VAULT_ENCRYPTION_KEY values for Preview and Production.

# Pooled Postgres URL used at runtime. Local: end with ?sslmode=disable.
# Hosted URLs need no edit: sslmode=require is upgraded to verify-full in code.
DATABASE_URL=
# Direct (non-pooled) URL, used by `pnpm db:migrate` only.
DATABASE_URL_UNPOOLED=
# 32 bytes, base64: openssl rand -base64 32
KEY_VAULT_ENCRYPTION_KEY=
# Optional: canonical origin if served from a domain the Host header does not report.
APP_ORIGIN=
```

Append to `.gitignore`:

```
# Playwright
/test-results
/playwright-report
```

`LICENSE`: carry the old repo's MIT licence.

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry LICENSE LICENSE
mkdir -p docs/superpowers/specs docs/superpowers/plans
git -C "$OLD" show claude/sveltekit-port-spec:docs/superpowers/specs/2026-09-25-sveltekit-port-design.md > docs/superpowers/specs/2026-09-25-sveltekit-port-design.md
git -C "$OLD" show claude/sveltekit-port-spec:docs/superpowers/plans/2026-09-25-port-plan-1-foundation.md > docs/superpowers/plans/2026-09-25-port-plan-1-foundation.md
```

`AGENTS.md`:

````markdown
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
````

`README.md`:

````markdown
# node-canvas

A conversation is a graph, not a list. Bring your own Anthropic key and talk
to it on a canvas of cards: branch any reply, keep every branch.

Desktop only. MIT licensed.

## Run it

Requires Node 22.9+ and pnpm 9.

```bash
pnpm install
cp .env.example .env        # fill DATABASE_URL and KEY_VAULT_ENCRYPTION_KEY
pnpm db:migrate
pnpm dev
```

## Checks

```bash
pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e
```

## How a key is protected

| Question | Answer |
| --- | --- |
| Where does the key live? | `provider_keys.ciphertext` in Postgres. Nowhere else. |
| What encrypts it? | AES-256-GCM under `KEY_VAULT_ENCRYPTION_KEY`, a server-only secret. |
| What does a database dump give an attacker? | Ciphertext, IV, GCM tag and the last four characters. Nothing usable. |
| Can a row be moved to another account? | No. The ciphertext is bound to `<userId>:anthropic` as additional authenticated data. |
````

- [ ] **Step 6: Verify the scaffold builds**

Run: `pnpm install && pnpm check && pnpm lint && pnpm build`
Expected: all exit 0. (`pnpm test` has no files yet; it is exercised from Task 2.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold node-canvas (SvelteKit 2, Svelte 5, adapter-vercel)

Carries the design spec and Plan 1 from njmrmd/node-canvas-chat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API error envelope and JSON body reader

**Files:**
- Create: `src/lib/server/api-error.ts`
- Test: `src/lib/server/api-error.test.ts` (carried `src/lib/http.test.ts` + new cases)

**Interfaces:**
- Produces:
  - `ERROR_CODES`, `type ErrorCode`
  - `class ApiError extends Error { code: ErrorCode; fields?: Record<string,string>; headers?: Record<string,string> }` — `new ApiError(code, message, { fields?, headers? })`
  - `statusFor(code: ErrorCode): number`
  - `errorResponse(error: ApiError): Response`
  - `withRoute(name: string, handler: RequestHandler): RequestHandler`
  - `DEFAULT_MAX_BODY_BYTES = 262144`; `readJsonBody(request: Request, options?: { maxBytes?: number }): Promise<Record<string, unknown>>`

- [ ] **Step 1: Carry the body-reader tests and add envelope tests**

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/lib/http.test.ts src/lib/server/api-error.test.ts
sed -i '' 's#from "./http";#from "./api-error";#' src/lib/server/api-error.test.ts
```

In `src/lib/server/api-error.test.ts`, extend the `./api-error` import to `{ ApiError, DEFAULT_MAX_BODY_BYTES, errorResponse, readJsonBody, withRoute }`, add `import type { RequestEvent } from "@sveltejs/kit";` to the imports, and append:

```ts
describe("errorResponse", () => {
  it("maps a code to its status and the envelope", async () => {
    const res = errorResponse(new ApiError("rate_limited", "Slow down.", { headers: { "Retry-After": "30" } }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "30");
    assert.deepEqual(await res.json(), { error: { code: "rate_limited", message: "Slow down." } });
  });

  it("includes per-field messages only when present", async () => {
    const res = errorResponse(new ApiError("invalid_request", "Check the form.", { fields: { email: "Enter your email address." } }));
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).error.fields, { email: "Enter your email address." });
  });
});

describe("withRoute", () => {
  const event = {} as RequestEvent;

  it("turns an ApiError into its envelope", async () => {
    const handler = withRoute("t", async () => { throw new ApiError("unauthenticated", "Please sign in to continue."); });
    const res = await handler(event);
    assert.equal(res.status, 401);
  });

  it("never leaks an unexpected error's message", async () => {
    const handler = withRoute("t", async () => { throw new Error("connection to postgres://secret failed"); });
    const res = await handler(event);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /postgres|secret/);
    assert.match(text, /internal_error/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './api-error'`.

- [ ] **Step 3: Implement `src/lib/server/api-error.ts`**

```ts
import { isHttpError, isRedirect, json, type RequestHandler } from '@sveltejs/kit';

/**
 * One error envelope for every JSON route:
 *   { "error": { "code": "invalid_credentials", "message": "…", "fields"?: {…} } }
 * `code` is the stable contract; `message` is written for the person who hit it.
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
	'unsupported_model',
	'no_key_configured',
	'rate_limited',
	'csrf_failed',
	'not_configured',
	'internal_error'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	invalid_request: 400,
	payload_too_large: 413,
	unauthenticated: 401,
	not_found: 404,
	email_taken: 409,
	invalid_credentials: 401,
	invalid_api_key: 400,
	provider_unavailable: 502,
	unsupported_model: 400,
	no_key_configured: 409,
	rate_limited: 429,
	csrf_failed: 403,
	not_configured: 503,
	internal_error: 500
};

export function statusFor(code: ErrorCode): number {
	return STATUS_BY_CODE[code];
}

export type ApiErrorBody = {
	error: { code: ErrorCode; message: string; fields?: Record<string, string> };
};

/** Thrown anywhere below a route; `withRoute` turns it into the envelope. */
export class ApiError extends Error {
	readonly code: ErrorCode;
	readonly fields?: Record<string, string>;
	readonly headers?: Record<string, string>;

	constructor(
		code: ErrorCode,
		message: string,
		options?: { fields?: Record<string, string>; headers?: Record<string, string> }
	) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.fields = options?.fields;
		this.headers = options?.headers;
	}
}

export function errorResponse(error: ApiError): Response {
	const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
	if (error.fields) body.error.fields = error.fields;
	return json(body, {
		status: statusFor(error.code),
		headers: { 'Cache-Control': 'no-store', ...error.headers }
	});
}

/**
 * The "logging without leakage" boundary for JSON routes: an ApiError becomes
 * its envelope; anything else is logged by name/message and returned as a
 * generic internal_error. SvelteKit redirects and HTTP errors pass through.
 */
export function withRoute(name: string, handler: RequestHandler): RequestHandler {
	return async (event) => {
		try {
			return await handler(event);
		} catch (error) {
			if (isRedirect(error) || isHttpError(error)) throw error;
			if (error instanceof ApiError) return errorResponse(error);
			console.error(`[${name}] unhandled error:`, error instanceof Error ? error.message : 'unknown');
			return errorResponse(
				new ApiError('internal_error', 'Something went wrong on our side. Please try again.')
			);
		}
	};
}

/** Per-route cap, in UTF-8 bytes. Routes whose payload grows pass their own. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(
	request: Request,
	options?: { maxBytes?: number }
): Promise<Record<string, unknown>> {
	const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().includes('application/json')) {
		throw new ApiError('invalid_request', 'Expected a JSON request body.');
	}

	const length = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(length) && length > maxBytes) throw tooLarge();

	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength > maxBytes) throw tooLarge();

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new ApiError('invalid_request', 'Request body is not valid JSON.');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ApiError('invalid_request', 'Request body must be a JSON object.');
	}
	return parsed as Record<string, unknown>;
}

function tooLarge(): ApiError {
	return new ApiError('payload_too_large', 'Request body is too large.');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test`
Expected: PASS — the 6 carried `readJsonBody` tests and 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/api-error.ts src/lib/server/api-error.test.ts
git commit -m "feat(server): API error envelope, withRoute and the size-capped JSON reader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Carry the pure security modules

**Files:**
- Create (carried): `src/lib/server/crypto/vault.ts`, `src/lib/server/crypto/password.ts`, `src/lib/server/auth/csrf.ts`, `src/lib/auth/next-path.ts`, `src/lib/auth/credentials.ts`
- Test (carried): the matching `*.test.ts` beside each

**Interfaces:**
- Consumes: `ApiError` (Task 2).
- Produces (unchanged from the old repo):
  - `sealApiKey(plaintext, userId, provider): SealedKey`, `openApiKey(sealed, userId, provider): string`, `maskedSuffix(apiKey): string`, `CURRENT_KEY_VERSION`, `type SealedKey = { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: number }`
  - `hashPassword(password): Promise<string>`, `verifyPassword(password, stored): Promise<boolean>`, `dummyPasswordHash(): Promise<string>`
  - `assertSameOrigin(request: Request): void` (throws `ApiError('csrf_failed')`)
  - `safeNextPath(value): string | null`, `resolveNextPath(value): string`, `signInHref(next?): string`, `DEFAULT_SIGNED_IN_PATH = "/keys"`
  - `checkEmail(value): string | null`, `checkNewPassword(value)`, `checkExistingPassword(value)`, `normaliseEmail(value)`, `checkCredentials(mode, { email, password }): Record<string,string>`, `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_MAX_LENGTH = 200`

- [ ] **Step 1: Carry tests first**

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/lib/crypto/vault.test.ts     src/lib/server/crypto/vault.test.ts
carry src/lib/crypto/password.test.ts  src/lib/server/crypto/password.test.ts
carry src/lib/auth/csrf.test.ts        src/lib/server/auth/csrf.test.ts
carry src/lib/auth/next-path.test.ts   src/lib/auth/next-path.test.ts
carry src/lib/auth/credentials.test.ts src/lib/auth/credentials.test.ts
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './vault'` (and the others).

- [ ] **Step 3: Carry the modules and fix their one import**

```bash
carry src/lib/crypto/vault.ts     src/lib/server/crypto/vault.ts
carry src/lib/crypto/password.ts  src/lib/server/crypto/password.ts
carry src/lib/auth/csrf.ts        src/lib/server/auth/csrf.ts
carry src/lib/auth/next-path.ts   src/lib/auth/next-path.ts
carry src/lib/auth/credentials.ts src/lib/auth/credentials.ts
sed -i '' 's#from "@/lib/http";#from "../api-error";#' src/lib/server/crypto/vault.ts src/lib/server/auth/csrf.ts
grep -rn '@/' src/lib || echo "no @/ imports left"
```

Expected: `no @/ imports left`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm check`
Expected: PASS (vault 10, password 7, csrf 8, next-path 10, credentials 10, plus Task 2's).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/crypto src/lib/server/auth src/lib/auth
git commit -m "feat(security): carry the key vault, scrypt, CSRF, safe redirects and credential rules

Unchanged from node-canvas-chat c215512 apart from import paths. The
provider key will live only in provider_keys.ciphertext, AES-256-GCM under
KEY_VAULT_ENCRYPTION_KEY with AAD \"<userId>:anthropic\"; a database read
yields ciphertext, IV, tag and last four characters.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Database layer, schema and the database test harness

**Files:**
- Create (carried): `src/lib/server/db-tls.mjs`, `src/lib/server/db-tls.test.ts`
- Create: `src/lib/server/db.ts`, `db/migrations/0001_init.sql`, `scripts/migrate.mjs`, `scripts/test-db.mjs`, `tests/support/test-db.ts`
- Test: `src/lib/server/schema.dbtest.ts`

**Interfaces:**
- Produces:
  - `tlsConnectionConfig(connectionString): { connectionString: string; ssl: { rejectUnauthorized: true } | undefined }`
  - `query<T>(text, params?): Promise<T[]>`, `queryOne<T>(text, params?): Promise<T | null>`, `closePool(): Promise<void>` — pool built lazily from `process.env.DATABASE_URL`; throws `ApiError('not_configured')` when unset
  - `migrate(connectionString, { log? }): Promise<number>` (from `scripts/migrate.mjs`)
  - `freshDatabase(): Promise<{ drop(): Promise<void> }>` — creates and migrates a new database, points `process.env.DATABASE_URL` at it
  - `pnpm test:db` runs `src/**/*.dbtest.ts`

- [ ] **Step 1: Carry TLS pinning and its test; confirm it passes**

```bash
OLD=/Users/nicholas/Workspace/node-canvas-chat
carry() { mkdir -p "$(dirname "$2")"; git -C "$OLD" show "c215512:$1" > "$2"; }
carry src/lib/db-tls.mjs  src/lib/server/db-tls.mjs
carry src/lib/db.test.ts  src/lib/server/db-tls.test.ts
pnpm test
```

Expected: PASS, including the 12 `database TLS` cases.

- [ ] **Step 2: Write the migration** — `db/migrations/0001_init.sql`

```sql
-- 0001_init: the whole node-canvas schema (spec §5). Fresh database; no data migrated.

create extension if not exists citext;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  -- scrypt verifier, scrypt$N$r$p$<salt b64>$<hash b64>. Never reversible.
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Server-side sessions so sign-out and deletion really revoke. Only the
-- SHA-256 of the cookie token is stored: a database read yields no cookie.
create table sessions (
  token_hash  bytea primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index sessions_user_id_idx on sessions(user_id);
create index sessions_expires_at_idx on sessions(expires_at);

-- One Anthropic key per user. ciphertext/iv/tag are AES-256-GCM under
-- KEY_VAULT_ENCRYPTION_KEY (server env only), AAD "<user_id>:anthropic".
create table provider_keys (
  user_id     uuid primary key references users(id) on delete cascade,
  ciphertext  bytea not null,
  iv          bytea not null,
  tag         bytea not null,
  last4       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One exchange per row. ids are minted by the browser.
create table nodes (
  id              uuid primary key,
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
  -- A node can only hang off a node owned by the same user; deleting a node
  -- deletes its subtree.
  foreign key (parent_id, user_id) references nodes(id, user_id) on delete cascade
);
create index nodes_user_id_idx on nodes(user_id);
create index nodes_parent_id_idx on nodes(parent_id);

create table canvas_view (
  user_id         uuid primary key references users(id) on delete cascade,
  viewport        jsonb not null,
  target_node_id  uuid references nodes(id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- Fixed-window counters; stale windows are deleted by the app on rollover.
create table rate_limits (
  bucket        text not null,
  subject       text not null,
  window_start  timestamptz not null,
  count         integer not null,
  primary key (bucket, subject, window_start)
);
```

- [ ] **Step 3: Migration runner** — `scripts/migrate.mjs`

```js
#!/usr/bin/env node
// Applies every db/migrations/*.sql exactly once, in filename order, each in
// a transaction, recording what it applied in schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { tlsConnectionConfig } from '../src/lib/server/db-tls.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

/**
 * @param {string} connectionString
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {Promise<number>} how many migrations were applied
 */
export async function migrate(connectionString, { log = console.log } = {}) {
	const client = new pg.Client(tlsConnectionConfig(connectionString));
	await client.connect();
	try {
		await client.query(
			'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())'
		);
		const applied = new Set(
			(await client.query('select name from schema_migrations')).rows.map((row) => row.name)
		);
		const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
		let ran = 0;
		for (const name of files) {
			if (applied.has(name)) continue;
			const sql = await readFile(path.join(dir, name), 'utf8');
			await client.query('begin');
			try {
				await client.query(sql);
				await client.query('insert into schema_migrations (name) values ($1)', [name]);
				await client.query('commit');
			} catch (error) {
				await client.query('rollback');
				throw error;
			}
			log(`applied ${name}`);
			ran += 1;
		}
		return ran;
	} finally {
		await client.end();
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set. See .env.example.');
		process.exit(1);
	}
	const ran = await migrate(url);
	console.log(ran === 0 ? 'Already up to date.' : `Applied ${ran} migration(s).`);
}
```

- [ ] **Step 4: Pool** — `src/lib/server/db.ts`

```ts
import pg, { type QueryResultRow } from 'pg';
import { ApiError } from './api-error';
import { tlsConnectionConfig } from './db-tls.mjs';

// One pool per server instance, kept on globalThis so dev hot reloads reuse
// it. max: 1 because a Vercel function instance serves one request at a time;
// point DATABASE_URL at a pooled endpoint.
const g = globalThis as typeof globalThis & { __nc_pool?: pg.Pool };

function pool(): pg.Pool {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new ApiError('not_configured', 'The database is not configured for this deployment yet.');
	}
	if (!g.__nc_pool) {
		g.__nc_pool = new pg.Pool({
			// Verified TLS whatever sslmode the URL carries (see db-tls.mjs).
			...tlsConnectionConfig(connectionString),
			max: 1,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
			// A stalled query fails fast instead of eating the request (TES-62).
			statement_timeout: 10_000,
			query_timeout: 10_000
		});
		g.__nc_pool.on('error', (error) => {
			console.error('[db] idle client error:', error.message);
		});
	}
	return g.__nc_pool;
}

/** Parameterised query. Values always go through `params`, never into `text`. */
export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await pool().query<T>(text, params)).rows;
}

export async function queryOne<T extends QueryResultRow>(
	text: string,
	params: unknown[] = []
): Promise<T | null> {
	return (await query<T>(text, params))[0] ?? null;
}

/** Tests only: end the pool so the next query builds one from DATABASE_URL again. */
export async function closePool(): Promise<void> {
	const current = g.__nc_pool;
	g.__nc_pool = undefined;
	await current?.end();
}
```

- [ ] **Step 5: Test harness**

`scripts/test-db.mjs`:

```js
#!/usr/bin/env node
// Runs src/**/*.dbtest.ts against a real Postgres: TEST_DATABASE_URL when set
// (CI's service container), otherwise an embedded Postgres started here.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const targets = process.argv.slice(2);
let url = process.env.TEST_DATABASE_URL;
let server;
let dir;

if (!url) {
	dir = await mkdtemp(path.join(tmpdir(), 'node-canvas-pg-'));
	const port = 55432;
	server = new EmbeddedPostgres({
		databaseDir: dir,
		port,
		user: 'postgres',
		password: 'postgres',
		persistent: false,
		onLog: () => {}
	});
	await server.initialise();
	await server.start();
	url = `postgres://postgres:postgres@localhost:${port}/postgres?sslmode=disable`;
}

const code = await new Promise((resolve) => {
	const child = spawn(
		process.execPath,
		['--import', 'tsx', '--test', '--test-concurrency=1', ...(targets.length ? targets : ['src/**/*.dbtest.ts'])],
		{ stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } }
	);
	child.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

if (server) {
	await server.stop();
	await rm(dir, { recursive: true, force: true });
}
process.exit(code);
```

`tests/support/test-db.ts`:

```ts
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { closePool } from '../../src/lib/server/db';

/**
 * A brand-new, migrated database for one test file. Points the app's pool
 * (process.env.DATABASE_URL) at it; `drop()` closes the pool and removes it.
 */
export async function freshDatabase(): Promise<{ drop: () => Promise<void> }> {
	const admin = process.env.TEST_DATABASE_URL;
	if (!admin) throw new Error('TEST_DATABASE_URL is not set. Run database tests with `pnpm test:db`.');

	const name = `t_${randomBytes(6).toString('hex')}`;
	await adminQuery(admin, `create database ${name}`);
	const url = new URL(admin);
	url.pathname = `/${name}`;
	await migrate(url.toString(), { log: () => {} });
	process.env.DATABASE_URL = url.toString();

	return {
		drop: async () => {
			await closePool();
			await adminQuery(admin, `drop database ${name} with (force)`);
		}
	};
}

async function adminQuery(connectionString: string, sql: string): Promise<void> {
	const client = new pg.Client({ connectionString });
	await client.connect();
	try {
		await client.query(sql);
	} finally {
		await client.end();
	}
}
```

- [ ] **Step 6: Write the schema tests** — `src/lib/server/schema.dbtest.ts`

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { query, queryOne } from './db';

let db: Awaited<ReturnType<typeof freshDatabase>>;
before(async () => {
	db = await freshDatabase();
});
after(() => db.drop());

async function user(email: string): Promise<string> {
	const row = await queryOne<{ id: string }>(
		"insert into users (email, password_hash) values ($1, 'x') returning id",
		[email]
	);
	return row!.id;
}

function node(id: string, userId: string, parentId: string | null) {
	return query(
		`insert into nodes (id, user_id, parent_id, prompt, status, x, y, position_mode, created_at, updated_at)
		 values ($1, $2, $3, 'p', 'complete', 0, 0, 'auto', now(), now())`,
		[id, userId, parentId]
	);
}

const count = async (table: string, userId: string) =>
	Number((await queryOne<{ n: string }>(`select count(*) as n from ${table} where user_id = $1`, [userId]))!.n);

describe('schema', () => {
	it('treats emails as case-insensitive and unique', async () => {
		await user('Case@Example.test');
		await assert.rejects(user('case@example.test'), /duplicate key/);
	});

	it('refuses a parent that belongs to another user', async () => {
		const a = await user('a@example.test');
		const b = await user('b@example.test');
		const parent = randomUUID();
		await node(parent, a, null);
		await assert.rejects(node(randomUUID(), b, parent), /foreign key/);
	});

	it('deleting a node deletes its whole subtree', async () => {
		const u = await user('tree@example.test');
		const [root, child, grandchild, other] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
		await node(root, u, null);
		await node(child, u, root);
		await node(grandchild, u, child);
		await node(other, u, null);
		await query('delete from nodes where id = $1 and user_id = $2', [root, u]);
		const left = await query<{ id: string }>('select id from nodes where user_id = $1', [u]);
		assert.deepEqual(left.map((r) => r.id), [other]);
	});

	it('clears the view target when that node is deleted', async () => {
		const u = await user('view@example.test');
		const n = randomUUID();
		await node(n, u, null);
		await query(`insert into canvas_view (user_id, viewport, target_node_id) values ($1, '{"x":0,"y":0,"zoom":1}', $2)`, [u, n]);
		await query('delete from nodes where id = $1', [n]);
		const view = await queryOne<{ target_node_id: string | null }>('select target_node_id from canvas_view where user_id = $1', [u]);
		assert.equal(view!.target_node_id, null);
	});

	it('deleting a user deletes everything they own', async () => {
		const u = await user('gone@example.test');
		await node(randomUUID(), u, null);
		await query("insert into sessions (token_hash, user_id, expires_at) values ('\\x00', $1, now() + interval '1 day')", [u]);
		await query("insert into provider_keys (user_id, ciphertext, iv, tag, last4) values ($1, '\\x00', '\\x00', '\\x00', 'abcd')", [u]);
		await query(`insert into canvas_view (user_id, viewport) values ($1, '{"x":0,"y":0,"zoom":1}')`, [u]);
		await query('delete from users where id = $1', [u]);
		for (const table of ['nodes', 'sessions', 'provider_keys', 'canvas_view']) {
			assert.equal(await count(table, u), 0, table);
		}
	});
});
```

- [ ] **Step 7: Run to verify**

Run: `pnpm test:db`
Expected: PASS — 5 schema tests (first run downloads nothing; the Postgres binary ships in the npm package).
Then: `pnpm check && pnpm lint && pnpm test` — PASS.

- [ ] **Step 8: Commit**

```bash
git add db scripts src/lib/server/db.ts src/lib/server/db-tls.mjs src/lib/server/db-tls.test.ts src/lib/server/schema.dbtest.ts tests/support/test-db.ts
git commit -m "feat(db): schema, migration runner, verified-TLS pool and a real-Postgres test harness

provider_keys holds only AES-256-GCM ciphertext/iv/tag and last4; the
vault key is not in the database. The composite FK on nodes makes
cross-user parent links impossible at the database level.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sessions and rate limits

**Files:**
- Create: `src/lib/server/auth/session.ts`, `src/lib/server/auth/session-cookie.ts`, `src/lib/server/rate-limit.ts`
- Test: `src/lib/server/auth/session.dbtest.ts`, `src/lib/server/auth/session-cookie.test.ts`, `src/lib/server/rate-limit.dbtest.ts`

**Interfaces:**
- Consumes: `query`, `queryOne` (Task 4); `ApiError` (Task 2).
- Produces:
  - `type SessionUser = { id: string; email: string }`
  - `createSession(userId): Promise<{ token: string; expiresAt: Date }>`, `getUserBySessionToken(token): Promise<SessionUser | null>`, `deleteSession(token): Promise<void>`, `deleteExpiredSessions(): Promise<number>`, `SESSION_TTL_DAYS = 30`
  - `SESSION_COOKIE = "nc_session"`, `setSessionCookie(cookies: Cookies, token, expiresAt)`, `clearSessionCookie(cookies: Cookies)`
  - `type RateLimitPolicy`, `type RateLimitResult`, `POLICIES` (`signUp`, `signIn`, `keyWrite`, `chat`, `nodeWrite`), `consume(policy, subject)`, `enforce(policy, subject)` (throws `ApiError('rate_limited')` with headers), `rateLimitHeaders(result, { retryAfter? })`, `userSubject(userId)`, `ipSubject(address)`

- [ ] **Step 1: Write the failing tests**

`src/lib/server/auth/session-cookie.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cookies } from '@sveltejs/kit';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session-cookie';

function fakeCookies() {
	const calls: { op: string; name: string; value?: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		set: (name: string, value: string, opts: Record<string, unknown>) => calls.push({ op: 'set', name, value, opts }),
		delete: (name: string, opts: Record<string, unknown>) => calls.push({ op: 'delete', name, opts })
	} as unknown as Cookies;
	return { cookies, calls };
}

describe('session cookie', () => {
	it('is httpOnly, SameSite=Lax, site-wide and expires with the session', () => {
		const { cookies, calls } = fakeCookies();
		const expiresAt = new Date(Date.now() + 1000);
		setSessionCookie(cookies, 'tok', expiresAt);
		assert.equal(calls[0].name, SESSION_COOKIE);
		assert.equal(calls[0].value, 'tok');
		assert.equal(calls[0].opts.httpOnly, true);
		assert.equal(calls[0].opts.sameSite, 'lax');
		assert.equal(calls[0].opts.path, '/');
		assert.equal(calls[0].opts.expires, expiresAt);
		assert.notEqual(calls[0].opts.secure, false, 'never explicitly insecure');
	});

	it('clears on the same path', () => {
		const { cookies, calls } = fakeCookies();
		clearSessionCookie(cookies);
		assert.deepEqual(calls[0], { op: 'delete', name: SESSION_COOKIE, opts: { path: '/' } });
	});
});
```

`src/lib/server/auth/session.dbtest.ts`:

```ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../../tests/support/test-db';
import { query, queryOne } from '../db';
import { createSession, deleteExpiredSessions, deleteSession, getUserBySessionToken } from './session';

let db: Awaited<ReturnType<typeof freshDatabase>>;
let userId: string;
before(async () => {
	db = await freshDatabase();
	userId = (await queryOne<{ id: string }>(
		"insert into users (email, password_hash) values ('s@example.test', 'x') returning id"
	))!.id;
});
after(() => db.drop());

describe('sessions', () => {
	it('resolves a fresh token to its user', async () => {
		const { token, expiresAt } = await createSession(userId);
		assert.ok(expiresAt.getTime() > Date.now() + 29 * 86_400_000);
		assert.deepEqual(await getUserBySessionToken(token), { id: userId, email: 's@example.test' });
	});

	it('stores only the SHA-256 of the token', async () => {
		const { token } = await createSession(userId);
		const hash = createHash('sha256').update(token, 'utf8').digest();
		const rows = await query<{ token_hash: Buffer }>('select token_hash from sessions');
		assert.ok(rows.some((r) => r.token_hash.equals(hash)));
		assert.ok(rows.every((r) => !r.token_hash.toString('utf8').includes(token)));
	});

	it('does not resolve an unknown or deleted token', async () => {
		assert.equal(await getUserBySessionToken('nope'), null);
		const { token } = await createSession(userId);
		await deleteSession(token);
		assert.equal(await getUserBySessionToken(token), null);
	});

	it('does not resolve, and sweeps, an expired session', async () => {
		const { token } = await createSession(userId);
		const hash = createHash('sha256').update(token, 'utf8').digest();
		await query("update sessions set expires_at = now() - interval '1 second' where token_hash = $1", [hash]);
		assert.equal(await getUserBySessionToken(token), null);
		assert.ok((await deleteExpiredSessions()) >= 1);
		assert.equal((await query('select 1 from sessions where token_hash = $1', [hash])).length, 0);
	});
});
```

`src/lib/server/rate-limit.dbtest.ts`:

```ts
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { ApiError } from './api-error';
import { query } from './db';
import { consume, enforce, ipSubject, userSubject } from './rate-limit';

let db: Awaited<ReturnType<typeof freshDatabase>>;
before(async () => {
	db = await freshDatabase();
});
after(() => db.drop());

const policy = { bucket: 'test', limit: 3, windowSeconds: 3600 };

describe('rate limits', () => {
	it('allows up to the limit, then refuses with headers', async () => {
		const subject = userSubject('u1');
		for (let i = 0; i < 3; i++) assert.equal((await consume(policy, subject)).allowed, true);
		await assert.rejects(enforce(policy, subject), (error: unknown) => {
			assert.ok(error instanceof ApiError);
			assert.equal(error.code, 'rate_limited');
			assert.equal(error.headers?.['RateLimit-Remaining'], '0');
			assert.ok(Number(error.headers?.['Retry-After']) > 0);
			return true;
		});
	});

	it('counts subjects independently, and namespaces them', async () => {
		assert.equal((await consume(policy, ipSubject('10.0.0.1'))).remaining, 2);
		assert.equal((await consume(policy, ipSubject('10.0.0.2'))).remaining, 2);
		assert.notEqual(ipSubject('x'), userSubject('x'));
	});

	it('deletes the subject’s stale windows when a new window starts', async () => {
		const subject = userSubject('u-stale');
		await query(
			"insert into rate_limits (bucket, subject, window_start, count) values ($1, $2, now() - interval '3 hours', 9)",
			[policy.bucket, subject]
		);
		await consume(policy, subject);
		const rows = await query<{ count: number }>(
			'select count from rate_limits where bucket = $1 and subject = $2',
			[policy.bucket, subject]
		);
		assert.deepEqual(rows.map((r) => r.count), [1]);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test && pnpm test:db`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/lib/server/auth/session.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { query, queryOne } from '../db';

export const SESSION_TTL_DAYS = 30;
const TOKEN_BYTES = 32;

export type SessionUser = { id: string; email: string };

/** Only this hash is stored, so database read access does not yield a usable cookie. */
function hashToken(token: string): Buffer {
	return createHash('sha256').update(token, 'utf8').digest();
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
	await query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [
		hashToken(token),
		userId,
		expiresAt
	]);
	return { token, expiresAt };
}

/** Expiry is enforced in SQL, so an expired row can never pass for a live one. */
export async function getUserBySessionToken(token: string): Promise<SessionUser | null> {
	return queryOne<SessionUser>(
		`select u.id, u.email::text as email
		   from sessions s join users u on u.id = s.user_id
		  where s.token_hash = $1 and s.expires_at > now()`,
		[hashToken(token)]
	);
}

export async function deleteSession(token: string): Promise<void> {
	await query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/** Housekeeping, run on sign-in. Returns how many rows went. */
export async function deleteExpiredSessions(): Promise<number> {
	return (await query('delete from sessions where expires_at <= now() returning 1')).length;
}
```

`src/lib/server/auth/session-cookie.ts`:

```ts
import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'nc_session';

/**
 * httpOnly: page scripts can never read it. SameSite=Lax: no cross-site POSTs.
 * `secure` is SvelteKit's default — true everywhere except http://localhost.
 */
export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', expires: expiresAt });
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
```

`src/lib/server/rate-limit.ts`:

```ts
import { ApiError } from './api-error';
import { query, queryOne } from './db';

export type RateLimitPolicy = {
	/** Bucket name; part of the counter key. */
	bucket: string;
	/** Requests permitted per window. */
	limit: number;
	/** Window length in seconds. */
	windowSeconds: number;
};

/** Every limit in the product, in one place. */
export const POLICIES = {
	/** Per IP: stops scripted account farming from one host. */
	signUp: { bucket: 'signup', limit: 5, windowSeconds: 3600 },
	/** Per IP: the credential-stuffing control. */
	signIn: { bucket: 'signin', limit: 10, windowSeconds: 900 },
	/** Per user: saving a key calls Anthropic. */
	keyWrite: { bucket: 'key_write', limit: 20, windowSeconds: 3600 },
	/** Per user: the main product action. */
	chat: { bucket: 'chat', limit: 60, windowSeconds: 3600 },
	/** Per user: a backstop against a runaway save loop, not a real limit on saving. */
	nodeWrite: { bucket: 'node_write', limit: 120, windowSeconds: 60 }
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitResult = {
	/** Whether this request was permitted (distinct from remaining === 0). */
	allowed: boolean;
	limit: number;
	remaining: number;
	/** When the current window ends. */
	resetAt: Date;
};

/** IETF RateLimit draft headers, plus Retry-After on a refusal. */
export function rateLimitHeaders(
	result: RateLimitResult,
	options?: { retryAfter?: boolean }
): Record<string, string> {
	const resetSeconds = Math.max(0, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
	const headers: Record<string, string> = {
		'RateLimit-Limit': String(result.limit),
		'RateLimit-Remaining': String(result.remaining),
		'RateLimit-Reset': String(resetSeconds)
	};
	if (options?.retryAfter) headers['Retry-After'] = String(resetSeconds);
	return headers;
}

/**
 * One atomic insert-or-increment. At the ceiling the `where count < limit`
 * guard matches no row, so an empty result is exactly and only a refusal.
 */
export async function consume(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
	const windowMs = policy.windowSeconds * 1000;
	const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
	const resetAt = new Date(windowStart.getTime() + windowMs);

	const row = await queryOne<{ count: number }>(
		`insert into rate_limits (bucket, subject, window_start, count)
		      values ($1, $2, $3, 1)
		 on conflict (bucket, subject, window_start) do update
		        set count = rate_limits.count + 1
		      where rate_limits.count < $4
		  returning count`,
		[policy.bucket, subject, windowStart, policy.limit]
	);

	if (!row) return { allowed: false, limit: policy.limit, remaining: 0, resetAt };

	// First hit of a new window: this subject's older windows are dead weight.
	if (row.count === 1) {
		await query('delete from rate_limits where bucket = $1 and subject = $2 and window_start < $3', [
			policy.bucket,
			subject,
			windowStart
		]);
	}

	return { allowed: true, limit: policy.limit, remaining: Math.max(0, policy.limit - row.count), resetAt };
}

/** Consumes, and throws a 429 carrying the same headers when refused. */
export async function enforce(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
	const result = await consume(policy, subject);
	if (result.allowed) return result;
	const minutes = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 60000));
	throw new ApiError(
		'rate_limited',
		`You have reached the limit of ${policy.limit} for this action. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
		{ headers: rateLimitHeaders(result, { retryAfter: true }) }
	);
}

/** Namespaced so an IP and a user id can never collide. */
export function userSubject(userId: string): string {
	return `user:${userId}`;
}

/** `address` comes from SvelteKit's `event.getClientAddress()` (the real peer on Vercel). */
export function ipSubject(address: string): string {
	return `ip:${address}`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm test:db && pnpm check`
Expected: PASS (session-cookie 2, sessions 4, rate limits 3, plus earlier).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/auth/session.ts src/lib/server/auth/session-cookie.ts src/lib/server/auth/*.test.ts src/lib/server/auth/*.dbtest.ts src/lib/server/rate-limit.ts src/lib/server/rate-limit.dbtest.ts
git commit -m "feat(auth): server-side sessions and fixed-window rate limits with housekeeping

Sessions store only SHA-256(token); a database read yields no usable
cookie. Expired sessions and stale rate-limit windows are now deleted.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Key store, Anthropic key validation and the fake Anthropic API

**Files:**
- Create: `src/lib/server/keys.ts`, `src/lib/server/anthropic.ts`, `tests/support/fake-anthropic.ts`
- Test: `src/lib/server/keys.dbtest.ts`, `src/lib/server/anthropic.test.ts`

**Interfaces:**
- Consumes: vault (Task 3), `query`/`queryOne` (Task 4), `ApiError` (Task 2).
- Produces:
  - `type KeySummary = { last4: string; updatedAt: string }`; `getKeySummary(userId): Promise<KeySummary | null>`, `saveKey(userId, apiKey): Promise<KeySummary>`, `getDecryptedKey(userId): Promise<string>` (throws `no_key_configured`), `deleteKey(userId): Promise<boolean>`
  - `clientFor(apiKey, timeoutMs): Anthropic` (honours `ANTHROPIC_BASE_URL`), `toApiError(error, context: 'validate' | 'chat'): ApiError`, `validateApiKey(apiKey): Promise<void>` (throws `invalid_api_key` / `provider_unavailable`)
  - `GOOD_KEY` and `startFakeAnthropic(port?): Promise<{ url: string; close(): Promise<void> }>` — `GET /v1/models` answers 200 for `GOOD_KEY`, 401 (Anthropic error JSON) otherwise. Plan 2 adds `POST /v1/messages`.

- [ ] **Step 1: Fake Anthropic API** — `tests/support/fake-anthropic.ts`

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The only key the fake accepts. Shaped like a real key; not a real key. */
export const GOOD_KEY = 'sk-ant-api03-FAKE-test-key-000000000000000000000000000000-good';

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

function handle(req: IncomingMessage, res: ServerResponse) {
	if (req.headers['x-api-key'] !== GOOD_KEY) {
		return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
	}
	if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
		return send(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
	}
	send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
}

/** Point the SDK at it with ANTHROPIC_BASE_URL=<url>. */
export function startFakeAnthropic(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const { port: bound } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${bound}`,
				close: () => new Promise((done) => server.close(() => done()))
			});
		});
	});
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/server/anthropic.test.ts`:

```ts
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { GOOD_KEY, startFakeAnthropic } from '../../../tests/support/fake-anthropic';
import { ApiError } from './api-error';
import { validateApiKey } from './anthropic';

let fake: Awaited<ReturnType<typeof startFakeAnthropic>>;
before(async () => {
	fake = await startFakeAnthropic();
	process.env.ANTHROPIC_BASE_URL = fake.url;
});
after(async () => {
	delete process.env.ANTHROPIC_BASE_URL;
	await fake.close();
});

describe('validateApiKey', () => {
	it('accepts a key Anthropic accepts', async () => {
		await validateApiKey(GOOD_KEY);
	});

	it('reports a rejected key as invalid_api_key with an actionable message', async () => {
		await assert.rejects(validateApiKey('sk-ant-api03-wrong'), (error: unknown) => {
			assert.ok(error instanceof ApiError);
			assert.equal(error.code, 'invalid_api_key');
			assert.match(error.message, /Anthropic rejected that key/);
			assert.doesNotMatch(error.message, /sk-ant/);
			return true;
		});
	});

	it('reports an unreachable provider as provider_unavailable', async () => {
		process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
		try {
			await assert.rejects(validateApiKey(GOOD_KEY), (error: unknown) => {
				assert.ok(error instanceof ApiError);
				assert.equal(error.code, 'provider_unavailable');
				return true;
			});
		} finally {
			process.env.ANTHROPIC_BASE_URL = fake.url;
		}
	});
});
```

`src/lib/server/keys.dbtest.ts`:

```ts
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { ApiError } from './api-error';
import { query, queryOne } from './db';
import { deleteKey, getDecryptedKey, getKeySummary, saveKey } from './keys';

const KEY = 'sk-ant-api03-EXAMPLE-NOT-A-REAL-KEY-0000000000-abcd';
let db: Awaited<ReturnType<typeof freshDatabase>>;
let a: string;
let b: string;

before(async () => {
	process.env.KEY_VAULT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
	db = await freshDatabase();
	const insert = (email: string) =>
		queryOne<{ id: string }>("insert into users (email, password_hash) values ($1, 'x') returning id", [email]);
	a = (await insert('a@example.test'))!.id;
	b = (await insert('b@example.test'))!.id;
});
after(() => db.drop());

describe('key store', () => {
	it('round-trips a key and shows only the last four', async () => {
		assert.equal(await getKeySummary(a), null);
		const summary = await saveKey(a, KEY);
		assert.equal(summary.last4, 'abcd');
		assert.equal(await getDecryptedKey(a), KEY);
		const row = await queryOne<{ ciphertext: Buffer }>('select ciphertext from provider_keys where user_id = $1', [a]);
		assert.ok(!row!.ciphertext.toString('utf8').includes('EXAMPLE'), 'ciphertext is not plaintext');
	});

	it('replacing a key overwrites the one row', async () => {
		await saveKey(a, `${KEY}-wxyz`);
		assert.equal((await getKeySummary(a))!.last4, 'wxyz');
		assert.equal((await query('select 1 from provider_keys where user_id = $1', [a])).length, 1);
	});

	it('a row copied onto another account does not decrypt', async () => {
		await query(
			`insert into provider_keys (user_id, ciphertext, iv, tag, last4)
			 select $2, ciphertext, iv, tag, last4 from provider_keys where user_id = $1`,
			[a, b]
		);
		await assert.rejects(getDecryptedKey(b), (e: unknown) => e instanceof ApiError && e.code === 'no_key_configured');
		await deleteKey(b);
	});

	it('deleting removes it; a missing key is no_key_configured', async () => {
		assert.equal(await deleteKey(a), true);
		assert.equal(await deleteKey(a), false);
		await assert.rejects(getDecryptedKey(a), (e: unknown) => e instanceof ApiError && e.code === 'no_key_configured');
	});
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test && pnpm test:db`
Expected: FAIL — `./anthropic` and `./keys` not found.

- [ ] **Step 4: Implement**

`src/lib/server/keys.ts`:

```ts
import { ApiError } from './api-error';
import { CURRENT_KEY_VERSION, maskedSuffix, openApiKey, sealApiKey } from './crypto/vault';
import { query, queryOne } from './db';

/** The one provider. Part of the AAD — changing it makes every stored key unreadable. */
const PROVIDER = 'anthropic';

export type KeySummary = { last4: string; updatedAt: string };

export async function getKeySummary(userId: string): Promise<KeySummary | null> {
	const row = await queryOne<{ last4: string; updated_at: Date }>(
		'select last4, updated_at from provider_keys where user_id = $1',
		[userId]
	);
	return row ? { last4: row.last4, updatedAt: row.updated_at.toISOString() } : null;
}

export async function saveKey(userId: string, apiKey: string): Promise<KeySummary> {
	const sealed = sealApiKey(apiKey, userId, PROVIDER);
	const row = await queryOne<{ updated_at: Date }>(
		`insert into provider_keys (user_id, ciphertext, iv, tag, last4)
		      values ($1, $2, $3, $4, $5)
		 on conflict (user_id) do update
		        set ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
		            last4 = excluded.last4, updated_at = now()
		  returning updated_at`,
		[userId, sealed.ciphertext, sealed.iv, sealed.authTag, maskedSuffix(apiKey)]
	);
	if (!row) throw new ApiError('internal_error', 'Could not save that key.');
	return { last4: maskedSuffix(apiKey), updatedAt: row.updated_at.toISOString() };
}

/** The only decrypt path. Its one caller is /api/chat, after the session check. */
export async function getDecryptedKey(userId: string): Promise<string> {
	const row = await queryOne<{ ciphertext: Buffer; iv: Buffer; tag: Buffer }>(
		'select ciphertext, iv, tag from provider_keys where user_id = $1',
		[userId]
	);
	if (!row) {
		throw new ApiError('no_key_configured', 'Connect your Anthropic key before sending a message.');
	}
	return openApiKey(
		{ ciphertext: row.ciphertext, iv: row.iv, authTag: row.tag, keyVersion: CURRENT_KEY_VERSION },
		userId,
		PROVIDER
	);
}

export async function deleteKey(userId: string): Promise<boolean> {
	return (await query('delete from provider_keys where user_id = $1 returning 1', [userId])).length > 0;
}
```

`src/lib/server/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from './api-error';

const VALIDATE_TIMEOUT_MS = 20_000;

/** ANTHROPIC_BASE_URL is for tests only (the fake API); unset in every deployment. */
export function clientFor(apiKey: string, timeoutMs: number): Anthropic {
	return new Anthropic({
		apiKey,
		timeout: timeoutMs,
		maxRetries: 1,
		baseURL: process.env.ANTHROPIC_BASE_URL || undefined
	});
}

/**
 * SDK error → our envelope. The provider's message can echo request content,
 * so it is never forwarded or logged; the class label and status are.
 */
export function toApiError(error: unknown, context: 'validate' | 'chat'): ApiError {
	const status = error instanceof Anthropic.APIError ? error.status : undefined;
	const log = (label: string) => console.error(`[anthropic] ${context}: ${label}, status=${status}`);

	if (error instanceof Anthropic.AuthenticationError) {
		log('AuthenticationError');
		return new ApiError(
			'invalid_api_key',
			'Anthropic rejected that key. Check that you copied it in full and that it is still active.'
		);
	}
	if (error instanceof Anthropic.PermissionDeniedError) {
		log('PermissionDeniedError');
		return new ApiError(
			'invalid_api_key',
			"That key does not have permission to use the Anthropic API. Check its scopes or your account's billing status."
		);
	}
	if (error instanceof Anthropic.RateLimitError) {
		log('RateLimitError');
		return new ApiError('provider_unavailable', 'Anthropic is rate limiting this key right now. Wait a moment and try again.');
	}
	if (error instanceof Anthropic.BadRequestError) {
		log('BadRequestError');
		return context === 'validate'
			? new ApiError(
					'invalid_api_key',
					'Anthropic rejected that key as malformed. Check that you pasted a full API key from console.anthropic.com.'
				)
			: new ApiError('provider_unavailable', 'Anthropic rejected this request. Try a shorter message or a different model.');
	}
	if (error instanceof Anthropic.APIConnectionError) {
		log('APIConnectionError');
		return new ApiError('provider_unavailable', 'Could not reach Anthropic. Please try again.');
	}
	if (error instanceof Anthropic.APIError) {
		log('APIError');
		return new ApiError('provider_unavailable', 'Anthropic returned an error. Please try again.');
	}
	log(error instanceof Error ? `non-SDK ${error.name}` : 'non-Error throw');
	return new ApiError('provider_unavailable', 'The model provider could not be reached. Please try again.');
}

/** An authenticated, token-free GET: proves the key works before we store it. */
export async function validateApiKey(apiKey: string): Promise<void> {
	try {
		await clientFor(apiKey, VALIDATE_TIMEOUT_MS).models.list({ limit: 1 });
	} catch (error) {
		throw toApiError(error, 'validate');
	}
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test && pnpm test:db && pnpm check && pnpm lint`
Expected: PASS (anthropic 3, key store 4, plus earlier).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/keys.ts src/lib/server/keys.dbtest.ts src/lib/server/anthropic.ts src/lib/server/anthropic.test.ts tests/support/fake-anthropic.ts
git commit -m "feat(keys): single-provider key store, Anthropic key validation and a fake API for tests

The key lives only in provider_keys.ciphertext, AES-256-GCM under
KEY_VAULT_ENCRYPTION_KEY with AAD \"<userId>:anthropic\"; getDecryptedKey
is the only decrypt path. A database read yields ciphertext, IV, tag and
last4; a row copied to another account fails its tag check (tested).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Request hook — session, guard, security headers, error handling

**Files:**
- Create: `src/lib/server/guard.ts`, `src/hooks.server.ts`, `src/routes/+layout.server.ts`, `src/lib/server/form.ts`
- Modify: `src/app.d.ts`
- Test: `src/lib/server/guard.test.ts`

**Interfaces:**
- Consumes: `getUserBySessionToken` (Task 5), `SESSION_COOKIE` (Task 5), `signInHref` (Task 3), `enforce` (Task 5), `ApiError` (Task 2).
- Produces:
  - `App.Locals.user: SessionUser | null`
  - `isProtected(pathname): boolean`, `SECURITY_HEADERS: Record<string, string>`
  - Root layout data `{ user: { email: string } | null }`
  - `str(value: FormDataEntryValue | null): string`, `rateLimitMessage(policy, subject): Promise<string | null>`

- [ ] **Step 1: Write the failing test** — `src/lib/server/guard.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProtected, SECURITY_HEADERS } from './guard';

describe('guard', () => {
	it('protects the canvas and keys screens and their subpaths', () => {
		for (const p of ['/canvas', '/keys', '/canvas/anything']) assert.equal(isProtected(p), true, p);
	});

	it('leaves public pages and look-alikes public', () => {
		for (const p of ['/', '/sign-in', '/sign-up', '/api/health', '/keysmith', '/canvases']) {
			assert.equal(isProtected(p), false, p);
		}
	});

	it('sets the fixed security headers', () => {
		assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
		assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY');
		assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin');
		assert.match(SECURITY_HEADERS['Strict-Transport-Security'], /max-age=63072000/);
		assert.match(SECURITY_HEADERS['Permissions-Policy'], /camera=\(\)/);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `./guard` not found.

- [ ] **Step 3: Implement**

`src/lib/server/guard.ts`:

```ts
const PROTECTED = ['/canvas', '/keys'];

/** Pages that need a signed-in user. JSON routes check the session themselves. */
export function isProtected(pathname: string): boolean {
	return PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Fixed headers on every response. The CSP comes from kit.csp in vite.config.ts. */
export const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
};
```

`src/lib/server/form.ts`:

```ts
import { ApiError } from './api-error';
import { enforce, type RateLimitPolicy } from './rate-limit';

/** A form field as a string ('' when missing or a file). */
export function str(value: FormDataEntryValue | null): string {
	return typeof value === 'string' ? value : '';
}

/** Runs a rate limit for a form action: null when allowed, the message when refused. */
export async function rateLimitMessage(policy: RateLimitPolicy, subject: string): Promise<string | null> {
	try {
		await enforce(policy, subject);
		return null;
	} catch (error) {
		if (error instanceof ApiError && error.code === 'rate_limited') return error.message;
		throw error;
	}
}
```

`src/app.d.ts`:

```ts
import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
		interface Error {
			message: string;
		}
	}
}

export {};
```

`src/hooks.server.ts`:

```ts
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { signInHref } from '$lib/auth/next-path';
import { getUserBySessionToken } from '$lib/server/auth/session';
import { SESSION_COOKIE } from '$lib/server/auth/session-cookie';
import { isProtected, SECURITY_HEADERS } from '$lib/server/guard';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getUserBySessionToken(token) : null;

	if (!event.locals.user && isProtected(event.url.pathname)) {
		redirect(303, signInHref(event.url.pathname + event.url.search));
	}

	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
};

/** Logs the route and message only; the page gets a generic sentence. */
export const handleError: HandleServerError = ({ error, event, status }) => {
	if (status !== 404) {
		console.error(
			`[${event.route.id ?? 'unknown route'}] unhandled error:`,
			error instanceof Error ? error.message : 'unknown'
		);
	}
	return { message: 'Something went wrong on our side. Please try again.' };
};
```

`src/routes/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user ? { email: locals.user.email } : null
});
```

- [ ] **Step 4: Run to verify**

Run: `pnpm test && pnpm check && pnpm lint && pnpm build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/hooks.server.ts src/app.d.ts src/routes/+layout.server.ts src/lib/server/guard.ts src/lib/server/guard.test.ts src/lib/server/form.ts
git commit -m "feat(auth): request hook — session lookup, protected pages, security headers, safe errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser-test rig and the sign-up / sign-in screens

**Files:**
- Create: `playwright.config.ts`, `tests/support/e2e-server.ts`, `tests/e2e/accounts.spec.ts`, `src/lib/styles/tokens.css`, `src/lib/styles/base.css`, `src/lib/copy/auth.ts`, `src/lib/components/{Shell,TextField,Button,Alert,AuthForm}.svelte`, `src/routes/sign-up/+page.{svelte,server.ts}`, `src/routes/sign-in/+page.{svelte,server.ts}`, `src/routes/canvas/+page.svelte`
- Modify: `src/routes/+layout.svelte`, `src/routes/+page.svelte`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces:
  - `AUTH_COPY`, `KEYS_COPY`, `type AuthMode = 'sign-up' | 'sign-in'`
  - Components: `Shell` (`{ children }`), `TextField` (`{ label, name, type?, value?, autocomplete?, hint?, note?, error?, required? }`), `Button` (`{ children, type?, variant?: 'primary'|'secondary'|'destructive', disabled?, full? }`), `Alert` (`{ tone: 'danger'|'ok'|'warning', title?, children }`), `AuthForm` (`{ mode, next, form }`)
  - Form action failure shape for auth: `{ email: string; fields?: Record<string,string>; message?: string }`
  - `pnpm test:e2e` (build → Postgres + fake Anthropic + `vite preview` on port 4173)

- [ ] **Step 1: Browser-test rig**

`tests/support/e2e-server.ts`:

```ts
// Everything Playwright's webServer needs: a fresh migrated database, the
// fake Anthropic API, and `vite preview` (a production build, so SvelteKit's
// cross-site form check is active) wired to both.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { startFakeAnthropic } from './fake-anthropic';

const APP_PORT = 4173;
const FAKE_ANTHROPIC_PORT = 4011;
const PG_PORT = 55433;

let admin = process.env.TEST_DATABASE_URL;
let server: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

if (!admin) {
	dataDir = await mkdtemp(path.join(tmpdir(), 'node-canvas-e2e-pg-'));
	server = new EmbeddedPostgres({
		databaseDir: dataDir,
		port: PG_PORT,
		user: 'postgres',
		password: 'postgres',
		persistent: false,
		onLog: () => {}
	});
	await server.initialise();
	await server.start();
	admin = `postgres://postgres:postgres@localhost:${PG_PORT}/postgres?sslmode=disable`;
}

const name = `e2e_${randomBytes(4).toString('hex')}`;
const adminClient = new pg.Client({ connectionString: admin });
await adminClient.connect();
await adminClient.query(`create database ${name}`);
await adminClient.end();
const url = new URL(admin);
url.pathname = `/${name}`;
await migrate(url.toString(), { log: () => {} });

const fake = await startFakeAnthropic(FAKE_ANTHROPIC_PORT);

const preview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(APP_PORT), '--strictPort'], {
	stdio: 'inherit',
	env: {
		...process.env,
		DATABASE_URL: url.toString(),
		KEY_VAULT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
		ANTHROPIC_BASE_URL: fake.url
	}
});

async function shutdown(code = 0) {
	preview.kill('SIGTERM');
	await fake.close();
	if (server) {
		await server.stop();
		await rm(dataDir!, { recursive: true, force: true });
	}
	process.exit(code);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
preview.on('exit', (code) => {
	if (code) void shutdown(code);
});
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// Desktop only. `pnpm test:e2e` builds first; the server script boots a fresh
// Postgres database, a fake Anthropic API and `vite preview`.
export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 60_000,
	retries: 0,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'node --import tsx tests/support/e2e-server.ts',
		url: 'http://localhost:4173/api/health',
		reuseExistingServer: false,
		timeout: 180_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 }
	},
	projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }]
});
```

Then: `pnpm exec playwright install chromium`.

- [ ] **Step 2: Write the failing browser tests** — `tests/e2e/accounts.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';

// The real sign-up limit (5 per IP per hour) applies here too, and every test
// runs from 127.0.0.1 against one fresh database. Budget: this file makes at
// most 4 counted sign-up attempts. Reuse accounts rather than adding sign-ups.
const email = (tag: string) => `e2e-${tag}-${Date.now()}@example.test`;
const PASSWORD = 'correct horse battery staple';

async function signUp(page: Page, address: string, password = PASSWORD) {
	await page.goto('/sign-up');
	await page.getByLabel('Email').fill(address);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Create account' }).click();
}

async function signIn(page: Page, address: string, password = PASSWORD) {
	await page.getByLabel('Email').fill(address);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

test('sign-up validates before it counts against the limit', async ({ page }) => {
	await signUp(page, 'not-an-email', 'short');
	await expect(page.getByText('That does not look like an email address')).toBeVisible();
	await expect(page.getByText('Use at least 10 characters')).toBeVisible();
	await expect(page).toHaveURL(/\/sign-up$/);
});

test('a taken email is refused without revealing anything else', async ({ page, context }) => {
	const address = email('taken');
	await signUp(page, address);
	await expect(page).toHaveURL(/\/keys$/);
	await context.clearCookies();
	await signUp(page, address);
	await expect(page.getByText('An account already exists for that email')).toBeVisible();
});

test('a protected page sends you to sign in, then back', async ({ page, context }) => {
	const address = email('next');
	await signUp(page, address);
	await context.clearCookies();
	await page.goto('/canvas');
	await expect(page).toHaveURL(/\/sign-in\?next=%2Fcanvas$/);
	await signIn(page, address);
	await expect(page).toHaveURL(/\/canvas$/);
});

test('wrong password is a generic refusal', async ({ page }) => {
	await page.goto('/sign-in');
	await signIn(page, email('nobody'), 'definitely-not-it');
	await expect(page.getByText('That email and password do not match.')).toBeVisible();
});

test('responses carry the security headers and a CSP', async ({ request }) => {
	const res = await request.get('/sign-in');
	const csp = res.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toMatch(/script-src 'self' ('nonce-|'sha256-)/);
	expect(res.headers()['x-content-type-options']).toBe('nosniff');
	expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('a cross-site form post is rejected', async ({ request }) => {
	const res = await request.post('/sign-in', {
		form: { email: 'x@example.test', password: 'whatever-long' },
		headers: { origin: 'https://evil.example' }
	});
	expect(res.status()).toBe(403);
});
```

Run: `pnpm test:e2e`
Expected: FAIL — `/sign-up` has no form (404 or no "Email" field).

- [ ] **Step 3: Styles**

`src/lib/styles/tokens.css`:

```css
:root {
	--background: #ffffff;
	--foreground: #18181b;
	--muted: #71717a;
	--hairline: #e4e4e7;
	--surface-subtle: #fafafa;
	--border-input: #8f8f99;
	--focus-ring: #2f6fdd;

	--danger: #b42318;
	--danger-border: #d92d20;
	--danger-surface: #fef3f2;
	--warning: #b54708;
	--warning-border: #dc6803;
	--warning-surface: #fffaeb;
	--success: #067647;
	--success-border: #099250;
	--success-surface: #ecfdf3;

	--font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
	--text-sm: 0.875rem;
	--text-base: 1rem;
	--text-lg: 1.125rem;
	--text-2xl: 1.5rem;

	--space-1: 4px;
	--space-2: 8px;
	--space-3: 12px;
	--space-4: 16px;
	--space-6: 24px;
	--space-8: 32px;

	--radius-sm: 6px;
	--radius-md: 8px;
	--dur-base: 180ms;
	--ease-out: cubic-bezier(0.2, 0, 0, 1);
}
```

`src/lib/styles/base.css`:

```css
*,
*::before,
*::after {
	box-sizing: border-box;
}
html,
body {
	margin: 0;
	background: var(--background);
	color: var(--foreground);
	font-family: var(--font-sans);
	font-size: var(--text-base);
	line-height: 1.5;
}
a {
	color: inherit;
	text-underline-offset: 3px;
}
:focus-visible {
	outline: 2px solid var(--focus-ring);
	outline-offset: 2px;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
}
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 4: Copy table** — `src/lib/copy/auth.ts`

```ts
export type AuthMode = 'sign-up' | 'sign-in';

export const AUTH_COPY = {
	'sign-up': {
		title: 'Create an account',
		subheading:
			'You bring your own model access. We never see your provider bill, and you can delete everything in one click.',
		submit: 'Create account',
		busy: 'Creating account…',
		passwordHint: 'At least 10 characters. Length beats punctuation.',
		passwordNote:
			'There is no password reset yet. If you lose this password, you lose the account and the key stored with it — save it in your password manager now.',
		footer: 'Already have an account?',
		footerLink: 'Sign in',
		footerHref: '/sign-in',
		autocomplete: 'new-password'
	},
	'sign-in': {
		title: 'Sign in',
		subheading: 'Welcome back.',
		submit: 'Sign in',
		busy: 'Signing in…',
		passwordHint: undefined,
		passwordNote: undefined,
		footer: 'No account yet?',
		footerLink: 'Create one',
		footerHref: '/sign-up',
		autocomplete: 'current-password',
		recovery:
			'Forgotten your password? We cannot reset it yet — that is a gap on our side, not a policy. The way back in is a new account, and you will need to reconnect your model key.'
	}
} as const;

export const AUTH_MESSAGES = {
	emailTaken: 'An account already exists for that email. Try signing in instead.',
	badCredentials: 'That email and password do not match.'
} as const;

export const KEYS_COPY = {
	title: 'Connect your model access',
	trust: [
		'Encrypted before it is stored, with a key held only by the server.',
		'Never sent back to this browser. No route returns it, not even to you.',
		'Every model call is made server-side, so the key never touches this page.',
		'Deleting your account deletes the key in the same transaction.'
	],
	keyLabel: 'Anthropic API key',
	keyHint: 'From console.anthropic.com → API keys. It starts with sk-ant-.',
	connect: 'Verify and save key',
	replace: 'Verify and replace key',
	verifying: 'Checking with Anthropic…',
	connected: (last4: string) => `Connected — key ending ${last4}`,
	notConnected: 'No key connected yet.',
	saved: 'Key verified and saved',
	remove: 'Remove key',
	emptyKey: 'Paste your Anthropic API key.',
	longKey: 'That is longer than any Anthropic API key. Check what you pasted.',
	openCanvas: 'Open the canvas',
	signOut: 'Sign out',
	deleteHeading: 'Delete this account',
	deleteBody:
		'Removes the account, every session, and the stored key in one transaction. This cannot be undone and there is no export.',
	deleteProvider: 'Your key stays valid at the provider — revoke it there too if you want it dead.',
	deleteConfirm: 'I understand this deletes everything',
	deleteButton: 'Delete account',
	deleteUnconfirmed: 'Tick the box to confirm.'
} as const;
```

- [ ] **Step 5: Components**

`src/lib/components/Shell.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="shell">
	<a class="wordmark" href="/">node-canvas</a>
	<main>{@render children()}</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: grid;
		grid-template-rows: auto 1fr;
		padding: var(--space-6) var(--space-8);
	}
	.wordmark {
		font-weight: 600;
		text-decoration: none;
	}
	main {
		width: 100%;
		max-width: 440px;
		margin: var(--space-8) auto;
	}
</style>
```

`src/lib/components/TextField.svelte`:

```svelte
<script lang="ts">
	let {
		label,
		name,
		type = 'text',
		value = '',
		autocomplete,
		hint,
		note,
		error,
		required = false
	}: {
		label: string;
		name: string;
		type?: string;
		value?: string;
		autocomplete?: HTMLInputElement['autocomplete'];
		hint?: string;
		note?: string;
		error?: string;
		required?: boolean;
	} = $props();

	const id = `field-${name}`;
	const describedBy = $derived(
		[error && `${id}-error`, hint && `${id}-hint`, note && `${id}-note`].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>
	<input
		{id}
		{name}
		{type}
		{value}
		{autocomplete}
		{required}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
	/>
	{#if error}<p class="error" id="{id}-error">{error}</p>{/if}
	{#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
	{#if note}<p class="note" id="{id}-note">{note}</p>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	label {
		font-size: var(--text-sm);
		font-weight: 500;
	}
	input {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		min-height: 40px;
		border: 1px solid var(--border-input);
		border-radius: var(--radius-sm);
		background: var(--background);
	}
	input[aria-invalid='true'] {
		border-color: var(--danger-border);
	}
	p {
		margin: 0;
		font-size: var(--text-sm);
	}
	.error {
		color: var(--danger);
	}
	.hint {
		color: var(--muted);
	}
	.note {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--surface-subtle);
	}
</style>
```

`src/lib/components/Button.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		type = 'submit',
		variant = 'primary',
		disabled = false,
		full = false,
		formaction
	}: {
		children: Snippet;
		type?: 'submit' | 'button';
		variant?: 'primary' | 'secondary' | 'destructive';
		disabled?: boolean;
		full?: boolean;
		formaction?: string;
	} = $props();
</script>

<button {type} {disabled} {formaction} class={variant} class:full>{@render children()}</button>

<style>
	button {
		font: inherit;
		font-weight: 500;
		min-height: 40px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		transition: opacity var(--dur-base) var(--ease-out);
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.full {
		width: 100%;
	}
	.primary {
		background: var(--foreground);
		color: var(--background);
	}
	.secondary {
		background: var(--background);
		border-color: var(--hairline);
	}
	.destructive {
		background: var(--danger);
		color: #fff;
	}
</style>
```

`src/lib/components/Alert.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tone, title, children }: { tone: 'danger' | 'ok' | 'warning'; title?: string; children?: Snippet } =
		$props();
</script>

<div class="alert {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
	{#if title}<p class="title">{title}</p>{/if}
	{#if children}{@render children()}{/if}
</div>

<style>
	.alert {
		padding: var(--space-3) var(--space-4);
		border-left: 3px solid;
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-4);
		font-size: var(--text-sm);
	}
	.title {
		margin: 0 0 var(--space-1);
		font-weight: 600;
	}
	.danger {
		background: var(--danger-surface);
		border-color: var(--danger-border);
		color: var(--danger);
	}
	.warning {
		background: var(--warning-surface);
		border-color: var(--warning-border);
		color: var(--warning);
	}
	.ok {
		background: var(--success-surface);
		border-color: var(--success-border);
		color: var(--success);
	}
</style>
```

`src/lib/components/AuthForm.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { AUTH_COPY, type AuthMode } from '$lib/copy/auth';
	import Alert from './Alert.svelte';
	import Button from './Button.svelte';
	import TextField from './TextField.svelte';

	type Failure = { email?: string; fields?: Record<string, string>; message?: string } | null;
	let { mode, next, form }: { mode: AuthMode; next: string | null; form: Failure } = $props();

	const copy = $derived(AUTH_COPY[mode]);
	const footerHref = $derived(next ? `${copy.footerHref}?next=${encodeURIComponent(next)}` : copy.footerHref);
	let busy = $state(false);
</script>

<h1>{copy.title}</h1>
<p class="sub">{copy.subheading}</p>

{#if form?.message}<Alert tone="danger">{form.message}</Alert>{/if}

<form
	method="POST"
	novalidate
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	}}
>
	<TextField label="Email" name="email" type="email" autocomplete="email" value={form?.email ?? ''} error={form?.fields?.email} required />
	<TextField
		label="Password"
		name="password"
		type="password"
		autocomplete={copy.autocomplete}
		hint={copy.passwordHint}
		note={copy.passwordNote}
		error={form?.fields?.password}
		required
	/>
	<Button full disabled={busy}>{busy ? copy.busy : copy.submit}</Button>
</form>

<p class="footer">{copy.footer} <a href={footerHref}>{copy.footerLink}</a></p>
{#if mode === 'sign-in'}<p class="recovery">{AUTH_COPY['sign-in'].recovery}</p>{/if}

<style>
	h1 {
		font-size: var(--text-2xl);
		margin: 0 0 var(--space-2);
	}
	.sub {
		color: var(--muted);
		margin: 0 0 var(--space-6);
	}
	.footer,
	.recovery {
		font-size: var(--text-sm);
		color: var(--muted);
		margin-top: var(--space-4);
	}
</style>
```

- [ ] **Step 6: Sign-up and sign-in routes**

`src/routes/sign-up/+page.server.ts`:

```ts
import { fail, redirect } from '@sveltejs/kit';
import { checkCredentials, normaliseEmail } from '$lib/auth/credentials';
import { resolveNextPath } from '$lib/auth/next-path';
import { AUTH_MESSAGES } from '$lib/copy/auth';
import { createSession } from '$lib/server/auth/session';
import { setSessionCookie } from '$lib/server/auth/session-cookie';
import { hashPassword } from '$lib/server/crypto/password';
import { queryOne } from '$lib/server/db';
import { rateLimitMessage, str } from '$lib/server/form';
import { ipSubject, POLICIES } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, resolveNextPath(url.searchParams.get('next')));
	return { next: url.searchParams.get('next') };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const data = await request.formData();
		const email = str(data.get('email'));
		const password = str(data.get('password'));

		// Validation first: a typo must not spend the IP's sign-up budget.
		const fields = checkCredentials('sign-up', { email, password });
		if (Object.keys(fields).length) return fail(400, { email, fields });

		const limited = await rateLimitMessage(POLICIES.signUp, ipSubject(getClientAddress()));
		if (limited) return fail(429, { email, message: limited });

		const row = await queryOne<{ id: string }>(
			'insert into users (email, password_hash) values ($1, $2) on conflict (email) do nothing returning id',
			[normaliseEmail(email), await hashPassword(password)]
		);
		if (!row) return fail(409, { email, message: AUTH_MESSAGES.emailTaken });

		const session = await createSession(row.id);
		setSessionCookie(cookies, session.token, session.expiresAt);
		redirect(303, resolveNextPath(url.searchParams.get('next')));
	}
};
```

`src/routes/sign-up/+page.svelte`:

```svelte
<script lang="ts">
	import AuthForm from '$lib/components/AuthForm.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Create an account · node-canvas</title></svelte:head>
<Shell><AuthForm mode="sign-up" next={data.next} {form} /></Shell>
```

`src/routes/sign-in/+page.server.ts`:

```ts
import { fail, redirect } from '@sveltejs/kit';
import { checkCredentials, normaliseEmail } from '$lib/auth/credentials';
import { resolveNextPath } from '$lib/auth/next-path';
import { AUTH_MESSAGES } from '$lib/copy/auth';
import { createSession, deleteExpiredSessions } from '$lib/server/auth/session';
import { setSessionCookie } from '$lib/server/auth/session-cookie';
import { dummyPasswordHash, verifyPassword } from '$lib/server/crypto/password';
import { queryOne } from '$lib/server/db';
import { rateLimitMessage, str } from '$lib/server/form';
import { ipSubject, POLICIES } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, resolveNextPath(url.searchParams.get('next')));
	return { next: url.searchParams.get('next') };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const data = await request.formData();
		const email = str(data.get('email'));
		const password = str(data.get('password'));

		const fields = checkCredentials('sign-in', { email, password });
		if (Object.keys(fields).length) return fail(400, { email, fields });

		const limited = await rateLimitMessage(POLICIES.signIn, ipSubject(getClientAddress()));
		if (limited) return fail(429, { email, message: limited });

		const row = await queryOne<{ id: string; password_hash: string }>(
			'select id, password_hash from users where email = $1',
			[normaliseEmail(email)]
		);
		// Always run scrypt, so response time does not reveal whether the email exists.
		const verified = await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()));
		if (!row || !verified) return fail(401, { email, message: AUTH_MESSAGES.badCredentials });

		await deleteExpiredSessions();
		const session = await createSession(row.id);
		setSessionCookie(cookies, session.token, session.expiresAt);
		redirect(303, resolveNextPath(url.searchParams.get('next')));
	}
};
```

`src/routes/sign-in/+page.svelte`:

```svelte
<script lang="ts">
	import AuthForm from '$lib/components/AuthForm.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Sign in · node-canvas</title></svelte:head>
<Shell><AuthForm mode="sign-in" next={data.next} {form} /></Shell>
```

- [ ] **Step 7: Placeholder landing and canvas pages**

`src/routes/+page.svelte` (the real landing page is Plan 4):

```svelte
<script lang="ts">
	import Shell from '$lib/components/Shell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>node-canvas</title></svelte:head>
<Shell>
	<h1>A conversation is a graph, not a list.</h1>
	<p>Bring your own Anthropic key and branch any reply into a new direction.</p>
	{#if data.user}
		<p><a href="/canvas">Open the canvas</a> · <a href="/keys">Your key</a></p>
	{:else}
		<p><a href="/sign-up">Create an account</a> · <a href="/sign-in">Sign in</a></p>
	{/if}
</Shell>
```

`src/routes/canvas/+page.svelte` (replaced in Plan 2):

```svelte
<script lang="ts">
	import Shell from '$lib/components/Shell.svelte';
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>
<Shell>
	<h1>Canvas</h1>
	<p>The canvas arrives in Plan 2. <a href="/keys">Manage your key</a></p>
</Shell>
```

- [ ] **Step 8: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:e2e`
Expected: PASS — 6 browser tests. (`/keys` does not exist yet, so the tests that land there only assert the URL.)

If the CSP test fails because the header is absent on form responses, inspect `curl -sI http://localhost:4173/sign-in` against a running `pnpm preview`; SvelteKit only adds CSP to rendered HTML pages, which is what the test requests.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(accounts): sign-up and sign-in with form actions, and the browser-test rig

Form posts are protected by SvelteKit's origin check (tested cross-site).
Sign-in always runs scrypt so timing does not reveal whether an email
exists. Browser tests run against a production build with a fresh
database and a fake Anthropic API.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The keys screen — connect, replace, remove, sign out, delete account

**Files:**
- Create: `src/routes/keys/+page.server.ts`, `src/routes/keys/+page.svelte`
- Modify: `tests/e2e/accounts.spec.ts` (append)

**Interfaces:**
- Consumes: `getKeySummary`, `saveKey`, `deleteKey` (Task 6), `validateApiKey` (Task 6), `deleteSession` (Task 5), `clearSessionCookie`, `SESSION_COOKIE` (Task 5), `KEYS_COPY` (Task 8), components (Task 8), `GOOD_KEY` (Task 6).
- Produces: named actions `?/connect`, `?/remove`, `?/signOut`, `?/deleteAccount`; failure shape `{ action: string; fields?: Record<string,string>; message?: string }`; success `{ action: 'connect'; saved: string }`.

- [ ] **Step 1: Add the failing browser test** — in `tests/e2e/accounts.spec.ts`, add `import { GOOD_KEY } from '../support/fake-anthropic';` to the imports, then append:

```ts
test('the whole account journey: key, sign out, sign in, delete', async ({ page }) => {
	const address = email('journey');
	await signUp(page, address);
	await expect(page).toHaveURL(/\/keys$/);
	await expect(page.getByText('No key connected yet.')).toBeVisible();
	await expect(page.getByText(address)).toBeVisible();

	// A key Anthropic rejects: explained on the screen where it was pasted.
	await page.getByLabel('Anthropic API key').fill('sk-ant-api03-wrong');
	await page.getByRole('button', { name: 'Verify and save key' }).click();
	await expect(page.getByText('Anthropic rejected that key')).toBeVisible();

	// A good key: stored, shown only as its last four characters.
	await page.getByLabel('Anthropic API key').fill(GOOD_KEY);
	await page.getByRole('button', { name: 'Verify and save key' }).click();
	await expect(page.getByText('Key verified and saved')).toBeVisible();
	await expect(page.getByText(`Connected — key ending ${GOOD_KEY.slice(-4)}`)).toBeVisible();
	await expect(page.locator('body')).not.toContainText(GOOD_KEY.slice(0, 20));

	await page.getByRole('button', { name: 'Remove key' }).click();
	await expect(page.getByText('No key connected yet.')).toBeVisible();

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.goto('/keys');
	await expect(page).toHaveURL(/\/sign-in\?next=%2Fkeys$/);

	await signIn(page, address);
	await expect(page).toHaveURL(/\/keys$/);

	await page.getByRole('button', { name: 'Delete account' }).click();
	await expect(page.getByText('Tick the box to confirm.')).toBeVisible();
	await page.getByLabel('I understand this deletes everything').check();
	await page.getByRole('button', { name: 'Delete account' }).click();
	await expect(page).toHaveURL(/\/$/);

	await page.goto('/sign-in');
	await signIn(page, address);
	await expect(page.getByText('That email and password do not match.')).toBeVisible();
});
```

Run: `pnpm test:e2e`
Expected: FAIL at the `/keys` assertions — the page does not exist.

- [ ] **Step 2: Implement** `src/routes/keys/+page.server.ts`

```ts
import { fail, redirect } from '@sveltejs/kit';
import { KEYS_COPY } from '$lib/copy/auth';
import { ApiError } from '$lib/server/api-error';
import { validateApiKey } from '$lib/server/anthropic';
import { deleteSession } from '$lib/server/auth/session';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/auth/session-cookie';
import { query } from '$lib/server/db';
import { rateLimitMessage, str } from '$lib/server/form';
import { deleteKey, getKeySummary, saveKey } from '$lib/server/keys';
import { POLICIES, userSubject } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

const MAX_KEY_LENGTH = 300;

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!; // hooks.server.ts redirects signed-out requests
	return { email: user.email, key: await getKeySummary(user.id) };
};

function requireUser(locals: App.Locals) {
	if (!locals.user) redirect(303, '/sign-in?next=%2Fkeys');
	return locals.user;
}

export const actions: Actions = {
	connect: async ({ request, locals }) => {
		const user = requireUser(locals);
		const apiKey = str((await request.formData()).get('apiKey')).trim();
		if (!apiKey) return fail(400, { action: 'connect', fields: { apiKey: KEYS_COPY.emptyKey } });
		if (apiKey.length > MAX_KEY_LENGTH) {
			return fail(400, { action: 'connect', fields: { apiKey: KEYS_COPY.longKey } });
		}

		const limited = await rateLimitMessage(POLICIES.keyWrite, userSubject(user.id));
		if (limited) return fail(429, { action: 'connect', message: limited });

		try {
			await validateApiKey(apiKey);
		} catch (error) {
			if (error instanceof ApiError) {
				return fail(error.code === 'invalid_api_key' ? 400 : 502, { action: 'connect', message: error.message });
			}
			throw error;
		}

		const saved = await saveKey(user.id, apiKey);
		return { action: 'connect', saved: saved.last4 };
	},

	remove: async ({ locals }) => {
		const user = requireUser(locals);
		await deleteKey(user.id);
		return { action: 'remove' };
	},

	signOut: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await deleteSession(token); // revoke server-side first
		clearSessionCookie(cookies);
		redirect(303, '/');
	},

	deleteAccount: async ({ request, locals, cookies }) => {
		const user = requireUser(locals);
		if (str((await request.formData()).get('confirm')) !== 'yes') {
			return fail(400, { action: 'deleteAccount', message: KEYS_COPY.deleteUnconfirmed });
		}
		// One statement; sessions, key, nodes and view cascade from users.
		await query('delete from users where id = $1', [user.id]);
		clearSessionCookie(cookies);
		redirect(303, '/');
	}
};
```

- [ ] **Step 3: Implement** `src/routes/keys/+page.svelte`

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/Alert.svelte';
	import Button from '$lib/components/Button.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { KEYS_COPY } from '$lib/copy/auth';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let verifying = $state(false);

	const failure = $derived(form && 'message' in form ? form : null);
	const fields = $derived(form && 'fields' in form ? form.fields : undefined);
</script>

<svelte:head><title>Your key · node-canvas</title></svelte:head>

<Shell>
	<p class="account">Signed in as <strong>{data.email}</strong></p>
	<h1>{KEYS_COPY.title}</h1>
	<ul class="trust">
		{#each KEYS_COPY.trust as line (line)}<li>{line}</li>{/each}
	</ul>

	{#if form?.action === 'connect' && 'saved' in form}
		<Alert tone="ok" title={KEYS_COPY.saved} />
	{/if}
	{#if failure?.action === 'connect' && failure.message}
		<Alert tone="danger">{failure.message}</Alert>
	{/if}

	<p class="status">{data.key ? KEYS_COPY.connected(data.key.last4) : KEYS_COPY.notConnected}</p>

	<form
		method="POST"
		action="?/connect"
		use:enhance={() => {
			verifying = true;
			return async ({ update }) => {
				await update();
				verifying = false;
			};
		}}
	>
		<TextField
			label={KEYS_COPY.keyLabel}
			name="apiKey"
			type="password"
			autocomplete="off"
			hint={KEYS_COPY.keyHint}
			error={fields?.apiKey}
			required
		/>
		<Button disabled={verifying}>
			{verifying ? KEYS_COPY.verifying : data.key ? KEYS_COPY.replace : KEYS_COPY.connect}
		</Button>
	</form>

	<div class="row">
		{#if data.key}
			<form method="POST" action="?/remove" use:enhance>
				<Button variant="secondary">{KEYS_COPY.remove}</Button>
			</form>
			<a href="/canvas">{KEYS_COPY.openCanvas}</a>
		{/if}
		<form method="POST" action="?/signOut" use:enhance>
			<Button variant="secondary">{KEYS_COPY.signOut}</Button>
		</form>
	</div>

	<section class="danger" aria-labelledby="danger-heading">
		<h2 id="danger-heading">{KEYS_COPY.deleteHeading}</h2>
		<p>{KEYS_COPY.deleteBody}</p>
		<p class="provider">{KEYS_COPY.deleteProvider}</p>
		{#if failure?.action === 'deleteAccount' && failure.message}
			<Alert tone="danger">{failure.message}</Alert>
		{/if}
		<form method="POST" action="?/deleteAccount" use:enhance>
			<label class="confirm"><input type="checkbox" name="confirm" value="yes" /> {KEYS_COPY.deleteConfirm}</label>
			<Button variant="destructive">{KEYS_COPY.deleteButton}</Button>
		</form>
	</section>
</Shell>

<style>
	.account,
	.status {
		color: var(--muted);
		font-size: var(--text-sm);
	}
	h1 {
		font-size: var(--text-2xl);
		margin: var(--space-2) 0 var(--space-4);
	}
	.trust {
		padding-left: var(--space-6);
		margin: 0 0 var(--space-6);
		font-size: var(--text-sm);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: var(--space-6) 0;
	}
	.danger {
		margin-top: var(--space-8);
		padding: var(--space-4);
		border: 1px solid var(--danger-border);
		border-radius: var(--radius-md);
	}
	.danger h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-base);
		color: var(--danger);
	}
	.danger p {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}
	.provider {
		font-weight: 500;
	}
	.confirm {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin: var(--space-3) 0;
		font-size: var(--text-sm);
	}
</style>
```

- [ ] **Step 4: Run to verify**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e`
Expected: PASS — 7 browser tests, all earlier suites.

- [ ] **Step 5: Commit**

```bash
git add src/routes/keys tests/e2e/accounts.spec.ts
git commit -m "feat(keys): connect, replace and remove the key; sign out; delete the account

The key is validated against Anthropic, then stored only in
provider_keys.ciphertext (AES-256-GCM under KEY_VAULT_ENCRYPTION_KEY, AAD
\"<userId>:anthropic\"); the page only ever receives last4. Account
deletion is one statement and cascades sessions, key, nodes and view.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: CI, the GitHub repository and the Vercel project

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a required `verify` check on every pull request; a production deployment at `https://node-canvas-theta.vercel.app`.

> **Steps 3–6 are outward-facing and need the user's explicit go-ahead in chat before each one** (creating a public repository, connecting Vercel, provisioning a database, setting secrets). Ask, wait for yes, then act. Never paste a secret value into chat or a command line that is echoed.

- [ ] **Step 1: Workflow** — `.github/workflows/ci.yml`

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm test:db
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results
          retention-days: 7
```

- [ ] **Step 2: Verify locally and commit**

Run: `pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e`
Expected: PASS.

```bash
git add .github/workflows/ci.yml
git commit -m "ci: one required workflow — check, lint, unit, database, build and browser tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3 (ask first): Create the public GitHub repository and push**

```bash
gh repo create njmrmd/node-canvas --public --source . --remote origin --description "A conversation is a graph, not a list. Bring your own Anthropic key." --push
gh repo edit njmrmd/node-canvas --enable-auto-merge --delete-branch-on-merge
```

Then confirm the first CI run is green: `gh run list --repo njmrmd/node-canvas --limit 1`.

- [ ] **Step 4 (ask first): Require the check on `main`**

```bash
gh api -X PUT repos/njmrmd/node-canvas/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F required_status_checks[strict]=true -F "required_status_checks[contexts][]=verify" \
  -F enforce_admins=false -F required_pull_request_reviews=null -F restrictions=null
```

- [ ] **Step 5 (the user does this in the Vercel dashboard): Project and database**

1. Vercel → Add New → Project → import `njmrmd/node-canvas`; accept the SvelteKit defaults; name it `node-canvas`.
2. Project → Storage → add Neon (Postgres). This creates `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for every environment.
3. Generate two different vault keys (`openssl rand -base64 32`, twice) and add `KEY_VAULT_ENCRYPTION_KEY` separately for **Production** and for **Preview** (Settings → Environment Variables, marked Sensitive).

- [ ] **Step 6 (ask first): Migrate the Neon database and deploy**

```bash
pnpm dlx vercel@latest link --project node-canvas --yes
pnpm dlx vercel@latest env pull .env --environment=production
pnpm db:migrate
rm .env
git commit --allow-empty -m "chore: trigger the first production deploy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push
```

Expected: `Applied 1 migration(s).`, then `curl -s https://node-canvas-theta.vercel.app/api/health` returns `{"ok":true,"commit":"<sha>"}` matching `git rev-parse --short HEAD`.

- [ ] **Step 7: Smoke-test production by hand**

Sign up at `https://node-canvas-theta.vercel.app/sign-up` with a throwaway address, connect a real key (the user does this — never type a real key on their behalf), confirm the last four show, delete the account.

---

## Self-review notes

- **Spec coverage (Plan 1's share):** §3 stack → Task 1; §5 schema → Task 4; §6 hooks, form actions, `GET /api/health` → Tasks 1, 7, 8, 9; §6 JSON helpers for Plan 2's routes → Task 2; §6 rate-limit table → Task 5; §7 security (vault, scrypt, sessions, CSRF for forms and JSON, tenant isolation at the database, headers/CSP, TLS, logging) → Tasks 2–9; §9 unit + database + browser layers and the fake Anthropic → Tasks 2–9; §10 CI, Vercel, Neon, separate vault keys → Task 10. Deferred by design to Plans 2–4: `nodes`/`canvas_view` routes and saving, `/api/chat`, the canvas, landing page, cutover.
- **Deviation from the spec, deliberate:** an index on `sessions(expires_at)` (supports the sign-in sweep); `canvas_view.target_node_id` has `on delete set null` (added in spec review).
- **Names used across tasks:** `ApiError`, `withRoute`, `readJsonBody`, `query`, `queryOne`, `closePool`, `freshDatabase`, `migrate`, `createSession`, `getUserBySessionToken`, `deleteSession`, `deleteExpiredSessions`, `SESSION_COOKIE`, `setSessionCookie`, `clearSessionCookie`, `POLICIES`, `enforce`, `consume`, `userSubject`, `ipSubject`, `rateLimitMessage`, `str`, `getKeySummary`, `saveKey`, `getDecryptedKey`, `deleteKey`, `validateApiKey`, `clientFor`, `toApiError`, `GOOD_KEY`, `startFakeAnthropic`, `isProtected`, `SECURITY_HEADERS`, `AUTH_COPY`, `AUTH_MESSAGES`, `KEYS_COPY` — each defined once, in the task listed in its Interfaces block.
