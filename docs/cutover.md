# Cutover: node-canvas replaces node-canvas-chat

Spec §10: once §1's success criteria pass on production, move any custom domain to the new project and
archive the old repository. There is no data to migrate: node-canvas has its own database.

Every step below is a production or account action. Do them yourself, in order.

## 1. Merge Plan 4

Plan 3 (PR #2) merged on 2026-10-07 and production runs it. Plan 4's PR stacks on it.

- [ ] Run `vercel env ls --scope rwazi-design` from the linked project and check that `DATABASE_URL` is listed
      for Production. On 2026-10-07 an edit to the Neon connection left it Preview-only, and the next
      production deploy answered every database page with a 500.
- [ ] In Vercel, open the `node-canvas` project (team `rwazi-design`) → Settings → Advanced, and turn on
      **Skew Protection**. With it, an open tab keeps talking to the deployment it loaded from, so a changed
      stream frame or API shape cannot break it mid-session. Plan 4 itself changes no stream frame or API
      shape (it touches pages, components, the canvas's client-side logic, copy and comments, and no server
      route), so this merge is safe either way; leave it on for the deploys after this one. If it stays off,
      reload open canvas tabs after any deploy that changes a frame or an API shape.
- [ ] Merge the Plan 4 PR once `verify` is green. Merging deploys production.
- [ ] `curl -s https://node-canvas-theta.vercel.app/api/health` reports the merge commit.

## 2. Check spec §1 on production

| Criterion | How it is checked |
| --- | --- |
| Feature parity on desktop | The browser suite (`pnpm test:e2e`), which CI's `verify` job runs, and the smoke test below. |
| Branching binds the composer every time | "Branch binds the composer to the chosen node, every time" in `tests/e2e/interaction.spec.ts`: 20 runs, on every CI run. |
| A canvas of any size saves; a failed save is visible | The paged load (`GET /api/nodes`): "a canvas larger than one load page arrives whole" in `tests/e2e/nodes-api.spec.ts`. "a 350 KB reply survives a reload" in `tests/e2e/canvas.spec.ts`. And "a failing save shows the banner, and a later success clears it" in `tests/e2e/banners.spec.ts`. |
| p95 ≤ 20 ms at 4× CPU, 50 nodes, 3 streams | `pnpm test:perf` (`tests/e2e/perf.spec.ts`). It depends on the machine, so CI does not run it: run it locally before cutover. |
| Every CI job blocks merging | One `verify` job (`.github/workflows/ci.yml`) runs `pnpm check`, lint, `pnpm test`, `pnpm test:db` and `pnpm test:e2e`. Branch protection on `main` requires it. |
| §7's security properties, each with a test | `pnpm test`: the key vault (`vault.test.ts`), password hashing (`password.test.ts`), the session cookie (`session-cookie.test.ts`), CSRF (`csrf.test.ts`). `pnpm test:db`: sessions (`session.dbtest.ts`), key storage (`keys.dbtest.ts`), tenant isolation (`nodes.dbtest.ts`, `schema.dbtest.ts`). `pnpm test:e2e`: the security headers and CSP, and a cross-site post refused (`accounts.spec.ts`). |

## 3. Smoke test with your own key

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

## 4. The link card

- [ ] Paste https://node-canvas-theta.vercel.app into Slack or Messages. It unfurls with "A conversation is a
      graph, not a list", the description and the three-card picture. Vercel's Deployment Protection must not
      cover the production URL, or crawlers cannot fetch the card. Previews behind Vercel Authentication do not
      unfurl (the page and `/og.png` answer 401): check the card on production, or with
      `curl -sI https://node-canvas-theta.vercel.app/og.png | head -1` (expect `HTTP/2 200`).

## 5. Retire the old app

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
