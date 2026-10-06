# Plan 2 follow-ups

These are the findings that Plan 2's reviews (per-task, final, and re-reviews) left open. Plan 3 should start from this list.
Everything not listed here was fixed on the `plan-2-canvas-core` branch.

## Cutover blockers (fix before the old app is switched off)

- **The canvas load has no size ceiling.**
  - Where: `loadCanvas` (`src/lib/server/nodes.ts`) puts every node's full prompt, response and thinking into `__data.json`.
  - Why it matters: Vercel caps a buffered function response at 4.5 MB. Past that, `/canvas` stops loading for a canvas that saved fine.
  - Fix: load metadata and previews and fetch bodies lazily, or stream the load.
  - Test: seed about 6 MB and open `/canvas` on a preview deployment.
- **Markdown is re-parsed in full on every streamed chunk.**
  - Where: `Markdown.svelte` runs `$derived(parseMarkdown(text))`.
  - Measured: 2.8 ms per parse at 300 KB. A 200 KB reply streamed in small deltas costs about 10 s of CPU.
  - Fix: parse incrementally, with stable blocks plus a re-parsed tail, or parse at most once per frame while streaming.
- **The first-token watchdog misreads a long silent thinking phase.**
  - Where: the relay drops Anthropic `ping` events.
  - Effect: more than 60 s of adaptive thinking with no summary delta reads as "Timed out" while the server is still streaming.
  - Fix: relay a heartbeat frame and count it as activity in `streams.ts`.

## Plan 3 — saver and save path

- **The 10-singles cap always picks the same suspects.**
  - Where: `saver.ts`. Ten or more permanently refused nodes can starve one that would now save.
  - Why now: Plan 3's delete and undo can orphan children, which creates exactly that.
  - Fix: rotate suspects, least recently tried first.
- **Suspects are sent after the view.**
  - Effect: after a transient failure on a new target node, the view saves first and the stored target becomes null.
  - Fix: send suspects in depth order ahead of dependants, and the view last.
- **`dispose()` saves before the stopped streams settle.** An in-app exit mid-stream saves `streaming`, which the next load repairs.
- **Two keepalives on tab close** (`visibilitychange` then `pagehide`) share Chrome's 64 KB keepalive budget. Share one budget.
- **Last-write-wins has no guard.**
  - An `updated_at` guard was tried and reverted, because it trusts browser clocks.
  - If the keepalive-vs-in-flight race matters, use a server-side revision counter instead.
- **`flush()` returns the in-flight promise** when a caller wants everything saved now.
- **Rejected ids from `PUT /api/nodes` are dropped silently.**

## Plan 3 — canvas behaviour and copy

- **A `complete` reply with no text** (thinking used all of `max_tokens`) still says "Available when the reply finishes." Change the condition to `status !== 'streaming'`.
- **The composer's blocked reason shows only as the placeholder**, so it is hidden once the user has typed.
- **Spec §4 lists a 100% zoom control.** Add a visible one alongside the "1" shortcut.
- **Svelte Flow reorders card DOM** under `onlyRenderVisibleElements`. Keyboard navigation must not rely on DOM order.
- **Copy:**
  - the offline banner says "new messages will fail", but sending is actually blocked;
  - the limit banner's reset time doesn't count down;
  - `node.action.openSettings` still says "Open settings";
  - `unauthenticated` and `unsupported_model` show the generic error line, with no sign-in hint.
- **Markdown polish:**
  - loose numbered lists all show "1.";
  - a lead-in line followed by a list collapses into one paragraph;
  - nested bullets keep their raw markers;
  - there is no `overflow-wrap` on long tokens.
- **Styles:** some literals (sizes, shadow, weight) should use tokens.

## Tests worth adding

- `/api/chat`:
  - abort propagation;
  - a mid-stream `error` frame;
  - the 2 MB cap.
- A pre-stream `ApiCallError` ends as `data-status="error"`.
- Clicking a card body (not Branch) leaves the composer target unchanged.
- Send stays disabled at the hourly limit.
- A starter prompt creates no card.
- Nodes:
  - a mixed owned-plus-foreign batch;
  - a foreign parent at the route level;
  - an unauthenticated `__data.json`.
- `signIn` specs need the local rig. Note in `e2e/README.md` that they can't target `E2E_BASE_URL`.

## Small hardening that can wait

- **`parseChatBody`:** require the last message to be from the user, and reject consecutive same-role messages.
- **`parseSaveBody`:** reject `parentId === id` and duplicate ids. Duplicates give a 500 today, but the saver never sends them.
- **`nodes.ts` error mapping:** any 23503 is reported as "parent not on this canvas".
- **Stale comments:** `chat-limits.ts`, `graph.ts` (React), and `copy.ts` (00:00 UTC).
