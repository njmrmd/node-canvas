# Plan 2, Plan 3 and Plan 4 follow-ups

Open review findings from Plan 2's and Plan 3's reviews (per task, final, and re-reviews). Plan 2's
were brought up to date after Plan 3 and stay under "Still open"; Plan 3's own are under "Plan 3
review findings (open)", apart from two saver points folded into Plan 2's Saver lines. Plan 4
resolved the items marked "before cutover", except the resize corner, which stays under Canvas; the rest
are under "Resolved in Plan 4".

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
  load refuses a signed-out reader; a pre-stream `ApiCallError` ends as `data-status="error"`
  (the hourly-limit test in `banners.spec.ts`, and `stream.test.ts`).

## Resolved in Plan 4

- **Copy.**
  - The offline banner says sending comes back with the connection.
  - The limit banner counts down, and ends on its own, even after a laptop sleeps past the reset. Before
    Plan 4 it never ended without a reload (the code dates from Plan 2's canvas), a bug Plan 4's review
    found.
  - The never-built "Open settings" is gone, with the other strings nothing rendered; an auth failure links
    to the key page.
  - A signed-out send says so. Its Sign in link opens sign-in in a new tab; the original tab keeps its
    changes and saves them once you are signed in.
  - A missing key gets its own line. So does an unavailable model: a card that failed this way says so, and
    Retry re-sends it with the model now chosen in the top bar.
  - A card with no text says that, not "didn't finish".
  - The desktop notice no longer promises a saved canvas to people with none.
  - A failed canvas load says it failed and offers Retry; a stalled one offers Retry too.
  - Stale comments in `copy.ts` and `chat-limits.ts` are rewritten.
- **Design.**
  - Dimmed cards stay at WCAG AA (opacity 0.75), and a failed card is never dimmed, so its error stays
    readable.
  - The composer's note no longer moves the field.
  - Shadows, weights and control heights in the canvas components come from tokens. The style test
    (`src/lib/styles/canvas-styles.test.ts`) keeps raw colours, literal font weights and pixel
    `min-height`s out of them.
- **Front door.**
  - A landing page, readable on phones.
  - A link card (`static/og.png`, rendered by `pnpm og:image`).

## Still open

### Saver

- `dispose()` saves before the stopped streams settle (the next load repairs it).
- Last-write-wins has no guard, and an unload DELETE can race an in-flight PUT of the same node. A
  browser-clock guard was tried and reverted; use a server-side revision counter if the
  keepalive-vs-in-flight race ever matters.
- `flush()` returns the in-flight promise when a caller wants everything saved now, so `dispose()`
  also misses a delete marked after the running flush took its snapshot.
- Rejected ids from `PUT /api/nodes` are dropped silently.

### Tests worth adding

- `/api/chat` abort propagation.
- Nodes: a mixed owned-plus-foreign batch; a foreign parent at the route level.

### Small hardening

- `parseChatBody`: require the last message to be from the user; reject consecutive same-role messages.
- `parseSaveBody`: reject `parentId === id` and duplicate ids (duplicates give a 500 today; the saver never sends them).
- `nodes.ts`: any 23503 is reported as "parent not on this canvas".

## Plan 3 review findings (open)

### Canvas

- Undo puts a branch back at its old positions, so a card created or tidied into the freed slot
  within 8 s gets covered. Reflow the parent's children on Undo when it has others.
- `focusCard` stops auto-follow even when it focuses the card being followed (Esc right after a send).
- Tab cannot reach the roving card while it is off screen (`onlyRenderVisibleElements` unmounts it);
  the arrows still work from anywhere.
- `reveal()` centres a card taller than the view, so its header sits off screen.
- Quick +/− presses read the zoom mid-transition. Step from the pending target zoom instead.
- Shrinking a card taller than the view by keyboard jumps the view once, on the press where it
  starts to fit. Let a resize always keep the moving edge in view.
- Use `interpolate: 'linear'` for the framing pan, so an interrupted pan never leaves the zoom dipped.
- A reopen shows a one-frame 40 px shift, because the first pass counts the collapsed parent's chip.
- Hidden cards still count as occupied space in `autoPlaceOnCreate`, in `reflowChildrenOnCreate`'s
  outside list, and in `layoutSubtree`.
- The linear view overlays the canvas's right 480 px, and Fit ignores it.
- The linear view can return focus to an element that is no longer in the page.
- The open thinking disclosure re-lays out all of the thinking text per token. This is Plan 2 code;
  the linear view's paragraph chunks (`paragraphs()`) are the fix's shape.
- `NodeCard` runs `canRetry`, which runs `childIds` (O(N)), per token on every mounted failed card.
  `store.childCount(id) === 0` would do.
- A crafted parent cycle (self-parent or a two-node cycle, through the user's own PUT) hangs
  `descendantIds` on delete.
- Nested lists skew ordered numbering in the markdown parser.
- Cmd+Opt+←/→ is reserved by Chrome and Firefox on macOS (tab switching), so check width resize on
  real hardware. Ctrl+Opt works.
- The resize corner on a card under 120 px tall first shrinks the card. This is the 1.7.0 clamp; the
  saved size ends valid.

### Accessibility

- The resize control's `aria-label` sits on a role-less div.
- The "n hidden" chip unmounts on activation, so focus goes to body.
- The subtree toggle pairs `aria-expanded` with a flipping label.
- The body toggle has no pressed state.
- `/canvas` has no `main` landmark at 900 px and up.
- `B` on a card that cannot be branched is refused silently.
- The toast's Undo drops focus when the delete had not moved it.

### Saver and server

- An impossible cursor date (month 13) returns 500 instead of 400. Map SQLSTATE class 22 to
  `invalid_request`.
- `withRoute` logs a client that disconnects mid-upload (ECONNRESET) as an unhandled error.
- The paged load has no `(user_id, created_at, id)` index (a later migration).
- Deploys: Plan 3 shipped on 2026-10-07. A tab still running the previous bundle meets the new server's
  frames. Plan 2's bundle turns any frame type it does not know into a failed card whose every save the
  server refuses, so the reply is lost on reload; Plan 3's `ping` was the frame that needed Vercel Skew
  Protection or a reload of open tabs at deploy. Plan 3's bundle ignores unknown frame types; a changed
  frame or API shape still needs Skew Protection or a backward-compatible change (`docs/cutover.md` §1
  checks it is on).

### Tests worth adding

- `__data.json` carries no node text.
- A db test for the `(created_at, id)` tie-break.
- `rectInView` and `focusOn` single-edge pins.
- A queued card in a removed branch.
- Retry leaves the target alone.
- Retry, Continue and Regenerate disabled offline or at the limit.
- The two halves of Task 8's height cache in `Canvas.svelte`.
- Review Focus #1: a deleted streaming branch stays gone after a reload.
- Review Focus #4: a delete just before the page closes.
- The perf spec's observer watches only streaming cards and ignores attributes, so it cannot catch
  a breach of §1.4's "only the streaming cards touch the DOM".
- `savedNodesText`'s 3 × 2 s budget exceeds `expect.poll`'s 5 s.
- The e2e teardown stops Postgres before the preview exits (the 57P01 noise).
