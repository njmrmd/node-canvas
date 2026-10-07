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
