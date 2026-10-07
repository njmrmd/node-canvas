# Cutover: node-canvas replaces node-canvas-chat

Spec §10: once §1's success criteria pass on production, move any custom domain to the new project and
archive the old repository. There is no data to migrate: node-canvas has its own database.

Every step below is a production or account action. Do them yourself, in order.

## 1. Merge Plan 4

Plan 3 (PR #2) merged on 2026-10-07 and production runs it. Plan 4's branch is built on Plan 3, and its PR
targets `main`.

- [ ] Run `vercel env ls --scope rwazi-design --project node-canvas` and check that `DATABASE_URL` is listed
      for Production. On 2026-10-06 an edit to the Neon connection left it Preview-only. Production kept
      running on its old environment until the 2026-10-07 deploy, which then answered every database page
      with a 500.
- [ ] Check that Skew Protection is on (Vercel → the `node-canvas` project, team `rwazi-design` → Settings →
      Advanced → Skew Protection). This command prints a `__vdpl` line when it is:
      `curl -s -D - -o /dev/null -H 'Sec-Fetch-Dest: document' https://node-canvas-theta.vercel.app/ | grep -i __vdpl`.
      If it is off, turn it on before merging.
  - With it on, an open tab keeps talking to the deployment it loaded from, so a changed stream frame or
    API shape cannot break it mid-session. It protects only tabs loaded from a deployment that was built
    while it was on.
  - Plan 4 itself changes no stream frame or API shape (it touches pages, components, the canvas's
    client-side logic, copy and comments, and no server route), so this merge is safe either way.
  - If it stays off, reload open canvas tabs after any deploy that changes a frame or an API shape.
- [ ] If the PR is not open yet: `git push -u origin plan-4-landing-copy-cutover`, then
      `gh pr create --base main`.
- [ ] Merge the Plan 4 PR once `verify` is green. Branch protection requires `verify` on `main` but does not
      bind repository admins (`enforce_admins` is off), so the owner can merge a red PR: look before you
      merge. Merging deploys production.
- [ ] Wait for the production deployment to finish, then `curl -s https://node-canvas-theta.vercel.app/api/health`.
      `commit` is the first 7 characters of the merge commit's SHA. A curl that is too early still shows the
      Plan 3 commit, `83bdcbf`.
- [ ] `/api/health` never touches the database, so also check a page that does. This request carries a junk
      session cookie, which makes the page look the session up in the database: it must answer 200, not 500.
      `curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: nc_session=check' https://node-canvas-theta.vercel.app/sign-in`.
      (Without a cookie, `/sign-in` never reaches the database, so a plain request would pass even in an
      outage.)

## 2. Confirm spec §1's success criteria

- [ ] `verify` is green on the merge commit's run (the workflow is `ci`; its one job is `verify`):
      `gh run list --branch main --limit 1`.
- [ ] On `main` after the merge (`git switch main && git pull`), run `pnpm test:perf` locally: p95 ≤ 20 ms.
      CI does not run it.

Where each criterion is tested:

| Criterion | How it is checked |
| --- | --- |
| Feature parity on desktop | The browser suite (`pnpm test:e2e`), which CI's `verify` job runs, and the smoke test below. |
| Branching binds the composer every time | "Branch binds the composer to the chosen node, every time" in `tests/e2e/interaction.spec.ts`: 20 runs, on every CI run. |
| A canvas of any size saves; a failed save is visible | The paged load (`GET /api/nodes`): "a canvas larger than one load page arrives whole" in `tests/e2e/nodes-api.spec.ts`. "a 350 KB reply survives a reload" in `tests/e2e/canvas.spec.ts`. And "a failing save shows the banner, and a later success clears it" in `tests/e2e/banners.spec.ts`. |
| p95 ≤ 20 ms at 4× CPU, 50 nodes, 3 streams | `pnpm test:perf` (`tests/e2e/perf.spec.ts`). It depends on the machine, so CI does not run it: run it locally before cutover. |
| Every CI job blocks merging | One `verify` job (`.github/workflows/ci.yml`) runs `pnpm check`, lint, `pnpm test`, `pnpm test:db` and `pnpm test:e2e`. Branch protection on `main` requires it, but not of admins (`enforce_admins` is off). |
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
      graph, not a list", the description and the three-card picture. Slack caches an unfurl per URL, so if
      the bare URL was pasted before this deploy, paste `https://node-canvas-theta.vercel.app/?v=2` instead.
      Vercel's Deployment Protection must not cover the production URL, or crawlers cannot fetch the card.
      Previews behind Vercel Authentication do not unfurl (the page and `/og.png` answer 401): check the card
      on production, or with `curl -sI https://node-canvas-theta.vercel.app/og.png | head -1` (expect
      `HTTP/2 200`).

## 5. Retire the old app

- [ ] There is no custom domain to move. On 2026-10-07, `vercel domains ls` found none under `rwazi-design`
      or `nicholasm`. If one exists by the time you cut over, move it to `node-canvas` first.
- [ ] Archive the old repository: `gh repo archive njmrmd/node-canvas-chat --yes`. You can unarchive it from
      the repository's settings.
- [ ] Retire what is left of the old deployment.
  - On 2026-10-07 there was no `node-canvas-chat` Vercel project under either scope, and the old app's last
    production deployment URL answered 410 ("The deployment has been removed").
  - The team has two Neon stores, and their names look alike. Only one is the old app's:
    - `neon-cyan-dog` (resource ID `store_1QVOvEqoKQ4XulQS`): the old app's database. On 2026-10-07 it had
      no connected project. This is the only store to delete.
    - `neon-sky-ferry` (resource ID `store_EzQpxKal4M223sy5`): **node-canvas's live production database**,
      connected to `node-canvas` (production, preview). It holds every account, encrypted key and canvas.
      **Never delete, detach or disconnect it.** Deleting it takes the app down and loses all of that.
  - Before you delete anything, check which is which:
    `vercel integration-resource inspect neon-cyan-dog --scope rwazi-design`. It must show
    `store_1QVOvEqoKQ4XulQS` and `No connected projects.` If it shows a connected project or another ID,
    stop: that is not the old app's store.
  - Once you no longer need the old app's canvases, delete it:
    `vercel integration-resource remove neon-cyan-dog --scope rwazi-design`, and confirm at the prompt.
    Never add `--disconnect-all` (`-a`) or `--yes` (`-y`). Nothing migrates from it. Treat the deletion as
    permanent. In the dashboard instead, open the store by its ID,
    https://vercel.com/rwazi-design/~/stores/integration/store_1QVOvEqoKQ4XulQS, not by its name, and check
    it lists no connected project before you delete it.
  - Then check production still reaches its database: the junk-cookie `/sign-in` request in §1 answers 200,
    and `vercel integration list --all --scope rwazi-design` still shows `neon-sky-ferry` connected to
    `node-canvas`.
