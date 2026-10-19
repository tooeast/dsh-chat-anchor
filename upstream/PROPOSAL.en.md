# Chat: add a follow-mode preference (`tail` | `anchor`)

**Package:** `@deepseek-ai/dsh-client-ui-chat`
**Base:** `dsh-v0.2.1-rc.2`
**Status:** design + implementation sketch, not built or tested. Prepared from
the tagged sources; the repository's build and browser-scenario tooling was not
available in the environment where this was written.

## Problem

Submitting a prompt always re-enables tail following. In `use-chat-scroll.ts`,
`processContent()` treats the new input as `ownInput` and calls
`reading.followTail()`, and every later content commit keeps the scrollport on
the floor (`tipChanged && reading.followingTail`). While an answer streams, the
transcript therefore keeps moving toward its bottom and the submitted prompt
scrolls out of view.

Terminal-style agents behave the other way round: the prompt is placed at the
top of the visible transcript and the answer grows downward, so the reader's
own question stays readable and nothing moves under the cursor.

Reading the same answer with the current policy is uncomfortable for long
answers, and the only workaround (scrolling up during every turn) is reset by
the next submission. There is no configuration key, Slot, or Client service
that controls this policy today: `ui-chat` exposes `transcriptView`,
`collapseTiming`, `performanceUsage`, and `linkOpening` only.

## Proposal

Add one Chat preference:

| Field | Values | Default |
|---|---|---|
| `ui-chat.follow` | `tail` (shipped behavior) · `anchor` | `tail` |

In `anchor` mode:

1. **On submit** the new prompt row is placed at the top of the transcript
   (16px clearance) before the browser paints, and tail following is released.
   The local submission echo is the first target; the durable user row takes
   over when it replaces the echo.
2. **While the answer streams** the viewport does not follow. Content grows
   below the prompt.
3. **Bottom room** keeps the anchored position reachable when the answer is
   shorter than the viewport: the message column reserves exactly
   `max(0, anchorTop + viewportHeight − contentHeight)` and shrinks it as the
   answer grows, so there is no extra blank to scroll into. The room sits
   before the sticky composer, which therefore keeps its place at the window
   foot.
4. **A reader gesture** (wheel, touch, pointer, scroll key) hands control back;
   the room is preserved so returning to the tail produces no layout jump.
5. **The back-to-bottom control** clears the room and restores tail following.
6. **The next prompt** anchors again. Session and view switches reset state.

Default stays `tail`, so nothing changes for anyone who does not opt in.

## Implementation sketch

### Commit 1 — preference plumbing (behavior unchanged)

`src/chat-settings.ts`

```ts
/** How the transcript viewport behaves while an answer streams. */
export const FOLLOW_MODES = ['tail', 'anchor'] as const
export type FollowMode = typeof FOLLOW_MODES[number]

/** Preserve the shipped bottom-follow behaviour for anyone without a preference. */
export const DEFAULT_FOLLOW: FollowMode = 'tail'

export interface ChatSettings {
  // …
  /** Streaming-follow behaviour; absence preserves tail following. */
  follow: FollowMode
}

export const ChatSettingsFields = {
  // …
  follow: z.union([...FOLLOW_MODES]).default(DEFAULT_FOLLOW),
}
```

`src/client/presentation-policy.ts` — the policy is where the Chat view already
learns its presentation choices, so carry the mode there. Keep object identity
stable as the current implementation does:

```ts
export interface ChatPresentationPolicy {
  // …
  /** Streaming-follow behaviour; `anchor` keeps the submitted prompt at the top. */
  readonly follow: FollowMode
}

const policyCache = new Map<string, ChatPresentationPolicy>()

export function presentationPolicyFor(
  mode: TranscriptViewMode,
  collapseTiming: CollapseTiming = 'completion',
  follow: FollowMode = 'tail',
): ChatPresentationPolicy {
  const key = `${follow}:${collapseTiming}:${mode}`
  let policy = policyCache.get(key)
  if (policy === undefined) {
    policy = Object.freeze({ ...TIMING_POLICIES[collapseTiming][mode], follow })
    policyCache.set(key, policy)
  }
  return policy
}

export function derivePresentationPolicy(
  mode: ObservableSnapshot<TranscriptViewMode>,
  collapseTiming: ObservableSnapshot<CollapseTiming>,
  follow: ObservableSnapshot<FollowMode>,
): ObservableSnapshot<ChatPresentationPolicy> {
  return {
    getSnapshot: () => presentationPolicyFor(mode.getSnapshot(), collapseTiming.getSnapshot(), follow.getSnapshot()),
    subscribe: (listener) => {
      const disposers = [mode.subscribe(listener), collapseTiming.subscribe(listener), follow.subscribe(listener)]
      return () => { for (const dispose of disposers) dispose() }
    },
  }
}
```

`src/client/apply.ts` — mirror the existing `linkOpening` store, and extend the
`transcript-view` row's injected face:

```ts
const follow = createSnapshotStore(chatSettings.getSnapshot().value?.follow ?? DEFAULT_FOLLOW)
ctx.effect(() => chatSettings.subscribe(() => {
  const accepted = chatSettings.getSnapshot().value?.follow
  if (accepted !== undefined) follow.set(accepted)
}))

const presentation = derivePresentationPolicy(
  transcriptView.mode, transcriptView.collapseTiming, follow,
)

// in the settings.general.item registration for the transcript row:
inject: (): TranscriptViewRowInjected => ({
  hooks: { transcriptView: transcriptView.mode, collapseTiming: transcriptView.collapseTiming, follow },
  setTranscriptView: (mode) => { transcriptView.setMode(mode) },
  setCollapseTiming: (timing) => { transcriptView.setCollapseTiming(timing) },
  setFollow: (next) => {
    follow.set(next)
    void chatSettings.set('follow', next).catch((_error: unknown) => {
      // The local choice stays usable when persistence is unavailable.
    })
  },
}),
```

`src/client/settings/TranscriptViewRow.tsx` — a third `PreferenceRow` next to
work details and collapse timing:

```tsx
<PreferenceRow
  title={t('settings.follow.title')}
  description={t('settings.follow.description')}
  value={followMode}
  selectedLabel={t(FOLLOW_LABELS[followMode])}
  options={FOLLOW_MODES.map(id => ({ id, label: t(FOLLOW_LABELS[id]) }))}
  onSelect={(value) => { setFollow(value as FollowMode) }}
/>
```

`src/client/locale.ts` — new keys (zh / en):

```
settings.follow.title:        回复位置 / Reply position
settings.follow.description:  回复时把最新提问固定在顶部，页面不跟随滚动。 / Keep the newest prompt at the top while the answer streams.
settings.follow.tail:         跟随回复 / Follow the answer
settings.follow.anchor:       固定我的提问 / Keep my prompt at the top
```

### Commit 2 — anchor behavior

`src/client/chat/ChatView.tsx` — pass the preference and render the room after
the flow slot, inside the message column (so it sits before the sticky
composer):

```tsx
const follow = usePresentation(policy => policy.follow)
const scroll = useChatScroll({ /* … */ follow })
// …
{renderSlot('conversation.chat.flow', { /* … */ })}
<div ref={scroll.anchorRoomRef} className={css.anchorRoom} aria-hidden="true" />
```

`ChatView.module.css`

```css
.anchorRoom {
  flex: none;
  pointer-events: none;
}
```

`src/client/chat/use-chat-scroll.ts` — the only policy branch that changes:

```ts
if (ownInput) {
  navigation.cancel()
  if (current.follow === 'anchor' && current.lastKey !== null && reading.anchorInput(current.lastKey)) return
  if (current.deferCompletedTurns && reading.followInputFold()) return
  reading.followTail(current.deferCompletedTurns ? 'smooth' : 'instant')
  return
}
```

`src/client/chat/use-chat-reading.ts` — one new method beside `followTail`:

```ts
/**
 * Anchor the submitted prompt at the top and release tail following.
 * @param nodeKey - the newest user row.
 * @returns whether the viewport could anchor it.
 */
anchorInput(nodeKey: string): boolean {
  const landing = this.viewport.anchorRow(nodeKey)
  if (landing === null) return false
  this.cancelPending()
  this.commit(landing, false, this.viewport.latestTurn)
  return true
}
```

`src/client/chat/use-chat-viewport.ts` — anchor the row and size the room:

```ts
/** Anchor one row at the top, reserving the room a short answer needs. */
anchorRow(nodeKey: string): ViewportLanding | null {
  const row = this.anchor(nodeKey, 'node')
  if (row === null || this.elements === null) return null
  this.resizeAnchorRoom(row)
  return this.align(row, 0, this.latestTurn)
}

/** Keep exactly the room that makes the anchored position reachable. */
private resizeAnchorRoom(row: HTMLElement): void {
  const room = this.elements?.anchorRoom
  if (room === null || room === undefined) return
  const metrics = this.metrics()
  if (metrics === null) return
  const rowTop = row.getBoundingClientRect().top - this.elements!.scroller.getBoundingClientRect().top
  const target = Math.max(0, metrics.top + rowTop)
  const content = this.elements!.scroller.scrollHeight - room.offsetHeight
  room.style.height = `${Math.max(0, target + metrics.height - content)}px`
}
```

A `ResizeObserver` on the message column recomputes `resizeAnchorRoom` as the
answer grows (the same observer that already feeds `reclaimBelow` can call it
when `follow === 'anchor'`). The room is cleared by `returnToBottom()`, by a
session/view switch, and when its height reaches 0.

## Edge cases

- **Short answer**: the room makes the anchored position reachable; at the
  exact minimum the floor *is* the anchor, so `followTail()` produces no
  movement and no extra blank can be scrolled into.
- **Reader leaves and re-enters the tail**: keep the room; dropping it would
  shrink the scroll range and shift the layout. Following at the minimal room
  is a no-op.
- **Long answer**: the room reaches 0 and the preference no longer applies;
  if the reader returned to the tail, normal following resumes.
- **Folding**: `collapseTiming: next-input` uses `followInputFold()` today. In
  anchor mode, anchor first and let folds preserve the reading position.
- **Reduced motion**: anchoring is an immediate positioning, so the existing
  reduced-motion path needs no change.
- **History paging** while anchored: the paging anchor compensation already
  preserves the reading position; the room must not join that compensation.
- **Session switch**: the room and anchor state are view-local and reset.

## Tests

Unit (package tests):

- `presentationPolicyFor(mode, timing, follow)` returns the same object for the
  same triple and a different policy for each mode.
- `ChatSettingsSchema` accepts `follow: 'anchor'`, rejects an unknown value,
  and defaults an absent field to `'tail'` (old saved settings).
- `ChatReading.anchorInput` publishes `followingTail: false` and persists the
  landing position (`store.save`).
- `useChatScroll` chooses `anchorInput` over `followTail` when
  `follow === 'anchor'` and the newest row is a user row.

Browser scenarios (the repository's scenario suite):

1. Send in a short session: the prompt is 16px from the top in the first
   painted frame after submit; no bottom flash.
2. Stream a long answer: the viewport does not move; the room shrinks to 0.
3. Scroll up during streaming, then back to the bottom: no layout jump, the
   room persists while it is still needed.
4. Back-to-bottom: the room is removed and tail following resumes.
5. Switch sessions and views while anchored: no stale room or observer.
6. `collapseTiming: next-input` and reduced motion: same anchored result.

## Compatibility and rollout

- Additive: a new settings field with a default; no migration needed.
- Absent or legacy settings resolve to `tail`, exactly today's behavior.
- Documented in `ui-chat`'s README under *Scroll ownership*, and in the
  Settings → General reference for the new row.

## Alternatives considered

- **CSS only** (`overflow-anchor`, padding): cannot create the missing scroll
  range, so a short answer cannot reach the top.
- **Client plugin**: works today by driving the transcript's DOM contract
  (`data-chat-flow`, `data-chat-following-tail`, `data-submission-echo`,
  `data-chat-turn`). It is the reference implementation for this proposal, but
  it depends on internal attributes and fails silently on refactors, which is
  exactly what this preference would remove.
- **Reverse default**: not proposed; the shipped behavior stays the default so
  no existing user is surprised.
