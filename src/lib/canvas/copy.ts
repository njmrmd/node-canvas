/**
 * Every user-facing string on the canvas, in one table.
 *
 * Reaching for a key is easier than typing a literal, so the keys are a closed union and `copy()` refuses at
 * compile time to render a template whose placeholders you have not supplied — `copy("limit.chip")` does not
 * type-check, and neither does passing `{used}` without `{total}`.
 *
 * Where the strings come from, by group:
 * - `SPEC_9`: the old app's copy table (§9 of its design document), carried over with the port. Plan 4's
 *   copy pass changed a few; each change carries a "Plan 4" comment.
 * - `SPEC_ELSEWHERE`: strings that document quoted outside its table.
 * - `REVIEW_APPROVED`: strings approved in the old app's design review.
 * - `PORT_RULED`: strings this port added, each with the plan that added it.
 *
 * Tone rule: state what happened and what to do next. No exclamation marks, no apologies, no "Oops". Never
 * blame the person for an error the system caused. `copy.test.ts` enforces the first two.
 */

/**
 * §9's table, verbatim, with Plan 4's exceptions: `coach.branch` and `node.status.thinkingLong` are gone because
 * nothing rendered them, and `offline.banner` was rewritten (marked inline).
 *
 * `{name}` placeholders are the spec's own. They are part of the string's type,
 * which is what makes the arity check below work.
 */
const SPEC_9 = {
  "empty.headline": "Ask anything. Then take it three directions.",
  "empty.sub":
    "Every message becomes a card. Branch from any card to explore another path.",
  "composer.placeholder": "Ask anything…",
  "composer.placeholder.reply": "Reply to this node…",
  "composer.target": "Replying to · {label}",
  "node.status.thinking": "Thinking",
  "node.status.queued": "Queued · {n} ahead",
  "node.status.stopped": "Stopped",
  "node.action.continue": "Continue",
  "node.action.regenerate": "Regenerate",
  "node.action.retry": "Retry",
  "node.action.branch": "Branch",
  "node.continuedFrom": "continued from above",
  "delete.undo": "Node deleted.",
  /* §1.5's confirm dialog is retired (TES-46 ruling: immediate delete + undo
   * toast, no blocking dialog) — this is the only place a subtree's count
   * still surfaces, so it carries what the dialog used to say. */
  "delete.undo.subtree": "Node and {n} below it deleted.",
  "limit.chip": "{used} / {total} this hour",
  "limit.banner":
    "You've used your {total} messages for this hour. Resets in {time}.",
  "provider.headline": "Connect a model to start",
  "provider.sub":
    "Bring your own API key. It's encrypted and only used for your requests.",
  "provider.cta": "Connect model access",
  /* Plan 4: sending is blocked while offline, so "new messages will fail" was wrong. */
  "offline.banner":
    "You're offline. Your canvas is still here, and you can send again once you're back online.",
  "save.failed.banner":
    "Some changes aren't saved yet. They keep retrying while this tab stays open.",
  "composer.newConversation": "New conversation",
  "composer.label": "Message",
  "node.thinking": "Reasoning summary",
  "branch.disabled": "Available when the reply finishes.",
} as const;

/**
 * Strings the spec states verbatim *outside* §9.
 *
 * §9 claims to be the whole inventory and is not — the §4.6 error table alone
 * is six user-facing sentences. These are quoted from the section named on each
 * group, not written here, so the table stays a transcription. Flagged to
 * Design Engineer: these belong in §9 so there is one list rather than two.
 */
const SPEC_ELSEWHERE = {
  /* §4.6 — the plain-language failure line, never a raw provider error. */
  "node.error.auth": "Your model key was rejected. Reconnect it on the key page.",
  "node.error.timeout": "The model didn't respond in time.",
  "node.error.network": "Couldn't reach the model. Check your connection.",
  "node.error.context_too_long":
    "This branch is too long for the model's context window.",
  "node.error.unknown": "Something went wrong on our side.",

  /* §3 — chosen so that branching is immediately worth doing. */
  "starter.1": "Name this product three different ways",
  "starter.2": "Explain recursion — then explain it to a 10-year-old",
  "starter.3": "Draft a cold email I can A/B",

  /* §4.12 and §4.7 give these as exact quoted placeholder text, just not in
   * the §9 table — the same "quoted from prose" treatment as the group above. */
  "composer.placeholder.offline": "Offline",
  "composer.placeholder.rateLimited": "Hourly limit reached",
} as const;

/**
 * Strings §9 does not name, approved as final copy on the TES-46 review
 * rather than transcribed from the spec document itself — the review is the
 * source for these, not §9's table, so they stay out of `SPEC_9` to keep that
 * object's "every string here is verbatim in the spec" invariant honest (its one exception is the Plan 4
 * rewrite of `offline.banner`, marked inline).
 * Shipped first as placeholders pending exactly this sign-off; see this
 * file's git history for the placeholder-vs-approved distinction while it
 * was open.
 */
const REVIEW_APPROVED = {
  /* §6 `<LinearView>` — heading and the Copy-all action. */
  "linearview.heading": "Linear view",
  "linearview.copyAll": "Copy all",
  "linearview.close": "Close linear view",
  /* §6 `<ShortcutsSheet>` — title and its close control. */
  "shortcuts.title": "Keyboard shortcuts",
  "shortcuts.close": "Close",
  /* §4.9 focus-path toggle — the spec names the key (`F`) and "a top-bar
   * toggle" but not its label. */
  "focuspath.toggle": "Focus path",
  /* §4.11 past the 5000ms load budget. */
  "canvas.loadError": "Taking longer than expected.",
  "canvas.loadRetry": "Retry",
  /* §6 `<Toast>`'s Undo action. */
  "delete.undo.action": "Undo",
} as const;

/**
 * Strings ruled on the port's Plan 2 final review, for states the spec does not
 * describe. Kept apart from the groups above for the same reason
 * `REVIEW_APPROVED` is: the source is the ruling, not the spec.
 */
const PORT_RULED = {
  /* Plan 2: the draft is over `MAX_MESSAGE_CHARS`; nothing is sent, the draft stays. */
  "composer.tooLong":
    "This message is too long to send. Shorten it to under 100,000 characters.",
  /* Plan 4: true of a reply that failed, stopped before any text, or finished empty — none will get text, so
   * branch.disabled would promise something that cannot happen. */
  "branch.failed":
    "This reply has no text to build on. Branch from another card, or start a new conversation.",
  /* Plan 3: the card's delete button (the old app's hard-coded label). */
  "node.action.delete": "Delete",
  /* Plan 3: card size controls — the old app's hard-coded labels (node-card.tsx at c215512). */
  "node.action.collapseBody": "Collapse to one line",
  "node.action.expandBody": "Show full reply",
  "node.action.collapse": "Collapse",
  "node.action.expand": "Expand ({n})",
  "node.action.resize": "Resize card",
  /* Plan 3: the chip on a collapsed card — the spec asks for a hidden-count chip and gives no wording. */
  "node.hiddenCount": "{n} hidden",
  /* Plan 3: the linear view's copy confirmation (the old app's hard-coded "Copied"), and its empty state
   * (the old app never showed an empty panel; this port opens it without a target too). */
  "linearview.copied": "Copied",
  "linearview.empty":
    "Nothing here yet. Send a message, or branch from a card, and its conversation shows here as text.",
  /* Plan 3: Copy all's failure (a refused clipboard) — the old app had no failure state. */
  "linearview.copyFailed": "Couldn't copy",
  /* Plan 3: the visible 100% control spec §4 lists beside zoom in/out and fit. */
  "zoom.reset": "Zoom to 100%",
  /* Plan 3: spec §2 / §8's notice below ~900 px. The old app had none; this is new wording. Plan 4 dropped
   * "Your canvas is saved and waiting there", because the notice also shows to people with no canvas. */
  "desktop.title": "node-canvas is built for desktop",
  "desktop.body": "Open it in a browser window at least 900 pixels wide.",
  /* Plan 4: the failure lines spec §4.6 never covered, and the one action each failure offers. Sign in opens a
   * new tab, because leaving this one would lose what changed since the session ended (the last save would be
   * refused); the card's own tab saves it once the session is back. */
  "node.error.noKey": "No model key is connected. Connect one on the key page.",
  "node.error.signedOut":
    "You've been signed out. Sign in again in the new tab this opens, then come back here — this tab keeps your changes and saves them.",
  "node.error.unsupportedModel":
    "This model isn't available any more. Choose another in the top bar, then press Retry.",
  "node.action.openKeys": "Open the key page",
  "node.action.signIn": "Sign in (new tab)",
  /* Plan 4: a canvas load that failed, as opposed to one that is only slow (canvas.loadError). */
  "canvas.loadFailed":
    "Couldn't load your canvas. Press Retry; if it keeps failing, reload the page.",
} as const;

export const COPY = {
  ...SPEC_9,
  ...SPEC_ELSEWHERE,
  ...REVIEW_APPROVED,
  ...PORT_RULED,
} as const;

export type CopyKey = keyof typeof COPY;

/**
 * The `{name}` placeholders inside a template, as a union of their names.
 *
 * Recursive over the tail, so a string with two placeholders yields both. A
 * string with none yields `never`, which is what lets `copy()` take exactly one
 * argument for a plain string and exactly two for a template.
 */
type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;

type VarsFor<K extends CopyKey> = Placeholders<(typeof COPY)[K]>;

/** `{n}` is a count everywhere it appears, so numbers are accepted unquoted. */
type Vars<K extends CopyKey> = Record<VarsFor<K>, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Renders a string from the table.
 *
 *   copy("node.status.stopped")            // "Stopped"
 *   copy("limit.chip", { used: 32, total: 50 })
 *
 * The rest-tuple is the whole trick: when a key has no placeholders `VarsFor`
 * is `never`, the tuple is `[]`, and passing a second argument is a type error;
 * when it has some, the tuple is required and its keys are checked. `[…] extends
 * [never]` rather than `VarsFor<K> extends never` because a bare conditional on
 * a naked type parameter distributes over the union and would collapse to
 * `never` for every multi-placeholder key.
 */
export function copy<K extends CopyKey>(
  key: K,
  ...[vars]: [VarsFor<K>] extends [never] ? [] : [Vars<K>]
): string {
  const template: string = COPY[key];

  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = (vars as Record<string, string | number> | undefined)?.[name];

    /*
     * Throwing beats rendering "Queued · {n} ahead" at a stranger. The types
     * already make this unreachable from TypeScript; the guard is for the
     * boundary where a value arrives as `undefined` at runtime anyway — a
     * count that has not loaded, a time that failed to format.
     */
    if (value === undefined || value === null) {
      throw new Error(`copy(${key}): no value for placeholder {${name}}.`);
    }

    return String(value);
  });
}

/**
 * Known gaps, kept here because this is where someone adding a string will look:
 * - There are no screen-reader announcements for card moves. Cards are named by their prompt
 *   (`aria-labelledby`), and their statuses are visible text.
 * - The old design had the limit banner say "Resets at 00:00 UTC — in 4h 12m". This app's window is the one
 *   the server enforces, so the banner says "Resets in {time}" and counts down while it shows.
 */
