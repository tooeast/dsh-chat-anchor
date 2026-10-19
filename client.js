/**
 * dsh-chat-anchor — keep the newest human prompt at the top of the transcript.
 *
 * `@deepseek-ai/dsh-client-ui-chat` owns a bottom-follow scroll policy: on every
 * submitted input it re-enables tail following, so each answer drags the page
 * toward its own bottom. That policy has no configuration switch and no slot
 * seam, so this Client module works with the transcript the way a terminal
 * reader would:
 *
 * 1. The send renders a local submission echo (`[data-submission-echo]`) before
 *    the durable record exists; the plugin pins that echo in the same task, so
 *    the prompt never lands at the bottom first. The durable user row
 *    (`[data-chat-flow-kind="user"]`) takes over the pin when it replaces it.
 * 2. A short answer leaves too little scroll range for the prompt to reach the
 *    top, so the message column (`[data-chat-flow]`) gets its own bottom room
 *    through a `::after` rule driven by `--chat-anchor-space`. The room sits
 *    before the sticky composer, so the composer stays at the window foot while
 *    the prompt holds the top. The room shrinks as the answer grows and
 *    disappears once the answer is tall enough.
 * 3. Chat attributes scroll movement against its last acknowledged position, so
 *    the move reads as reader movement and its sampling interval releases the
 *    follow intent; later growth leaves the viewport alone.
 *
 * A wheel, touch, pointer or scroll key on the transcript cancels the pin
 * immediately and hands control back. The back-to-bottom button and the next
 * prompt keep their usual meaning.
 *
 * The module keeps a small diagnostic record on `window.__dshChatAnchor` so a
 * misbehaving install can be inspected from the browser console.
 */

window.__ModuleLoader__.load({
  id: 'dsh-chat-anchor',
  factory(require) {
    /** Distance kept above the pinned prompt, in CSS pixels. */
    const PIN_OFFSET = 16
    /** Room kept between the pinned viewport foot and the sticky composer. */
    const COMPOSER_MARGIN = 48
    /** Give up on one prompt after a very long turn, instead of pinning forever. */
    const MAX_PIN_MS = 900_000
    /** Ignore rows that arrive this soon after a bulk load or a session switch. */
    const QUIET_MS = 600
    /** More than this many user rows in one batch means history, not a submission. */
    const BULK_ROWS = 2
    /** Bottom room is capped so a broken measurement cannot grow without bound. */
    const MAX_SPACE_VIEWPORTS = 2

    const STYLE = '[data-chat-anchor-room]::after{content:"";display:block;flex:0 0 auto;'
      + 'height:var(--chat-anchor-space,0px);pointer-events:none}'

    return {
      inject: ['slots'],
      apply(ctx) {
        const doc = document
        const win = window
        if (typeof win.MutationObserver !== 'function' || typeof win.requestAnimationFrame !== 'function') return

        const debug = {
          version: '1.7.0',
          appliedAt: Date.now(),
          columns: 0,
          batches: 0,
          userAdds: 0,
          echoAdds: 0,
          pins: 0,
          last: null,
          log: [],
        }
        const note = (entry) => {
          debug.last = entry
          debug.log.push(entry)
          if (debug.log.length > 12) debug.log.shift()
        }
        try { win.__dshChatAnchor = debug } catch { /* private-mode style refusal */ }

        /** One observed flow column and its own turn baseline. */
        const states = new Map()
        let scanFrame = 0
        let disposed = false
        /** The running pin loop, when one is active. */
        let run = null
        /** The room-maintenance owner, when one is kept after a pin. */
        let spaced = null
        /** The message column currently carrying the bottom-room attribute. */
        let spaceHost = null

        /** Whether an element is one human Chat row. */
        const isUserRow = (node) => node instanceof win.Element
          && node.getAttribute('data-chat-flow-kind') === 'user'

        /** Whether an element is the local echo of a transcript submission. */
        const isEchoRow = (node) => node instanceof win.Element
          && node.hasAttribute('data-submission-echo')
          && !node.hasAttribute('data-pending-steering')

        /** Turn number of one row, or -1 when the row carries none. */
        const turnOf = (row) => {
          const raw = row.getAttribute('data-chat-turn')
          const value = raw === null ? Number.NaN : Number(raw)
          return Number.isFinite(value) ? value : -1
        }

        /** Highest turn number among the rows currently in a subtree. */
        const maxTurnIn = (root) => {
          let max = -1
          for (const row of root.querySelectorAll('[data-chat-flow-kind="user"]')) {
            max = Math.max(max, turnOf(row))
          }
          return max
        }

        /** Conversation identity that owns a row; a change resets the turn space. */
        const sessionOf = (row) => {
          const el = row.closest('[data-conversation-session]')
          return el === null ? '' : el.getAttribute('data-conversation-session') ?? ''
        }

        /** The transcript scrollport: the same element Chat itself observes. */
        const scrollerFor = (row) => {
          const shared = row.closest('[data-conversation-scroll]')
          if (shared !== null && shared.clientHeight > 0) return shared
          let element = row.parentElement
          while (element !== null && element !== doc.documentElement) {
            const overflowY = win.getComputedStyle(element).overflowY
            if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
              && element.clientHeight > 0) return element
            element = element.parentElement
          }
          return null
        }

        /** The message column that holds the room, so it stays above the composer. */
        const roomHostFor = (row) => row.closest('[data-chat-flow]')

        /** Whether Chat still owns tail following for this row. */
        const following = (row) => row.closest('[data-chat-following-tail]') !== null

        /** Current bottom room applied to one message column. */
        const spaceOf = (host) => {
          if (host === null) return 0
          const value = Number.parseFloat(host.style.getPropertyValue('--chat-anchor-space'))
          return Number.isFinite(value) ? value : 0
        }

        /** Give one message column bottom room, or none at all. */
        const applySpace = (host, px) => {
          if (host === null) return
          if (spaceHost !== null && spaceHost !== host && spaceHost.isConnected) {
            spaceHost.style.setProperty('--chat-anchor-space', '0px')
            spaceHost.removeAttribute('data-chat-anchor-room')
          }
          const value = Math.max(0, Math.round(px))
          if (value === 0) {
            host.style.setProperty('--chat-anchor-space', '0px')
            host.removeAttribute('data-chat-anchor-room')
            if (spaceHost === host) spaceHost = null
            return
          }
          spaceHost = host
          host.setAttribute('data-chat-anchor-room', '')
          host.style.setProperty('--chat-anchor-space', `${value}px`)
        }

        /** Drop the maintenance observers without touching the applied room. */
        const stopMaintain = () => {
          if (spaced === null) return
          const current = spaced
          spaced = null
          current.ro.disconnect()
        }

        /** Drop any bottom room and stop maintaining it. */
        const clearSpace = () => {
          stopMaintain()
          if (spaceHost !== null) {
            const host = spaceHost
            spaceHost = null
            host.style.setProperty('--chat-anchor-space', '0px')
            host.removeAttribute('data-chat-anchor-room')
          }
        }

        /** Height of the sticky composer seat inside a scrollport, when present. */
        const composerHeightOf = (scroller) => {
          const seat = scroller.querySelector('[data-composer-seat]')
          if (seat === null) return 0
          const rect = seat.getBoundingClientRect()
          return Number.isFinite(rect.height) ? rect.height : 0
        }

        /**
         * Geometry for keeping one row at the pin offset.
         *
         * `pin` mode keeps a guard (the composer height plus a margin) so the
         * sticky composer stays below the viewport foot and the position is far
         * enough from the floor for Chat to release following.
         *
         * `keep` mode keeps only the reachability minimum: exactly enough room
         * that the pinned position still exists. At that minimum the composer
         * lands on the viewport foot by itself, and no extra blank can be
         * scrolled into; the room shrinks one-to-one as the answer grows.
         */
        const measure = (scroller, host, row, mode) => {
          const space = spaceOf(host)
          const contentHeight = scroller.scrollHeight - space
          const rowTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          const raw = scroller.scrollTop + rowTop - PIN_OFFSET
          const ideal = Math.max(0, raw)
          const viewport = scroller.clientHeight
          const guard = mode === 'pin' ? COMPOSER_MARGIN + composerHeightOf(scroller) : 0
          const need = Math.max(0, ideal + viewport + guard - contentHeight)
          return {
            space: Math.min(need, viewport * MAX_SPACE_VIEWPORTS),
            ideal,
            atTop: raw <= 0,
          }
        }

        /**
         * Keep the bottom room correct while an anchored answer grows.
         *
         * Following is deliberately not treated as a reason to drop the room:
         * with the minimal room the floor *is* the pinned position, so Chat
         * following the tail produces no movement. Dropping the room there would
         * shrink the scroll range and shift the whole layout, which is exactly
         * the jump a reader gets after leaving and re-entering the tail.
         */
        const maintain = (row, scroller, host) => {
          stopMaintain()
          if (host === null || !row.isConnected || !scroller.isConnected) {
            applySpace(host, 0)
            return
          }
          const update = () => {
            if (spaced === null) return
            if (!spaced.row.isConnected || !spaced.scroller.isConnected) {
              clearSpace()
              return
            }
            const { space } = measure(spaced.scroller, spaced.host, spaced.row, 'keep')
            if (space <= 0) { clearSpace(); return }
            applySpace(spaced.host, space)
          }
          const ro = new win.ResizeObserver(update)
          ro.observe(host)
          ro.observe(scroller)
          spaced = { row, scroller, host, ro }
          update()
        }

        /** Stop the active pin loop and detach its gesture listeners. */
        const stopPin = () => {
          if (run === null) return
          const current = run
          run = null
          win.cancelAnimationFrame(current.frame)
          current.release()
        }

        /** Pin one prompt until Chat releases following and the row is at the top. */
        const startPin = (row, reason) => {
          stopPin()
          // Keep any room already applied by the previous pin: zeroing it here
          // could clamp the position before the first new measurement lands.
          stopMaintain()
          if (disposed || !row.isConnected) return
          const scroller = scrollerFor(row)
          if (scroller === null) return
          const host = roomHostFor(row)
          const events = ['wheel', 'touchstart', 'pointerdown', 'keydown']
          const onGesture = () => {
            const current = run
            stopPin()
            if (current !== null) maintain(current.row, current.scroller, current.host)
          }
          for (const type of events) scroller.addEventListener(type, onGesture, { passive: true, capture: true })
          const state = {
            frame: 0,
            row,
            scroller,
            host,
            release() {
              for (const type of events) scroller.removeEventListener(type, onGesture, true)
            },
          }
          const started = win.performance.now()
          debug.pins += 1
          note({
            type: 'pin',
            reason,
            turn: turnOf(row),
            following: following(row),
            at: Date.now(),
          })
          const tick = () => {
            if (run !== state) return
            if (!row.isConnected || !scroller.isConnected) {
              stopPin()
              clearSpace()
              return
            }
            const m = measure(scroller, host, row, 'pin')
            applySpace(host, m.space)
            if (Math.abs(m.ideal - scroller.scrollTop) > 1.5) scroller.scrollTop = m.ideal
            else if (m.ideal === 0 && scroller.scrollTop === 0 && following(row)) scroller.scrollTop = 1
            if (m.atTop && !following(row)) {
              stopPin()
              maintain(row, scroller, host)
              return
            }
            if (win.performance.now() - started > MAX_PIN_MS) {
              stopPin()
              maintain(row, scroller, host)
              return
            }
            state.frame = win.requestAnimationFrame(tick)
          }
          run = state
          state.frame = win.requestAnimationFrame(tick)
        }

        /** Decide whether one appended user row is a fresh submission worth pinning. */
        const consider = (state, row) => {
          const now = win.performance.now()
          const turn = turnOf(row)
          const session = sessionOf(row)
          if (session !== state.session) {
            state.session = session
            state.maxTurn = turn >= 0 ? turn : -1
            state.quietUntil = now + QUIET_MS
            note({ type: 'session', session, turn })
            return
          }
          const older = turn >= 0 && turn <= state.maxTurn
          const quiet = now < state.quietUntil
          if (turn >= 0) state.maxTurn = Math.max(state.maxTurn, turn)
          if (quiet) { note({ type: 'skip', why: 'quiet', turn }); return }
          if (older) { note({ type: 'skip', why: 'older', turn, maxTurn: state.maxTurn }); return }
          startPin(row, 'submit')
        }

        /** Reading one batch: submissions pin, history and session swaps re-baseline. */
        const onMutations = (state, records) => {
          debug.batches += 1
          const added = []
          const echoes = []
          let removedRows = 0
          for (const record of records) {
            for (const node of record.removedNodes) {
              if (!(node instanceof win.Element)) continue
              if (isUserRow(node) || node.querySelector('[data-chat-flow-kind="user"]') !== null) removedRows += 1
            }
            for (const node of record.addedNodes) {
              if (!(node instanceof win.Element)) continue
              if (isUserRow(node)) added.push(node)
              for (const row of node.querySelectorAll('[data-chat-flow-kind="user"]')) added.push(row)
              if (isEchoRow(node)) echoes.push(node)
              for (const echo of node.querySelectorAll('[data-submission-echo]:not([data-pending-steering])')) echoes.push(echo)
            }
          }
          // A session swap replaces rows without adding a submission: reset the
          // turn space after the quiet window rather than compare across sessions.
          if (removedRows > 0 && added.length === 0) {
            state.maxTurn = -1
            state.quietUntil = win.performance.now() + QUIET_MS
            note({ type: 'swap', removedRows })
            return
          }
          if (added.length > BULK_ROWS) {
            state.maxTurn = maxTurnIn(state.el)
            state.quietUntil = win.performance.now() + QUIET_MS
            note({ type: 'history', added: added.length, maxTurn: state.maxTurn })
            return
          }
          // The local submission echo is rendered on the send itself, before the
          // durable record exists: pin it in the same task, so the prompt never
          // lands at the bottom first. The durable row replaces the pin later.
          if (added.length === 0 && echoes.length > 0) {
            debug.echoAdds += 1
            startPin(echoes[echoes.length - 1], 'echo')
            return
          }
          if (added.length === 0) return
          debug.userAdds += added.length
          consider(state, added[added.length - 1])
        }

        /** Observe one flow column until it leaves the document. */
        const bindColumn = (el) => {
          if (states.has(el)) return
          const state = {
            el,
            session: sessionOf(el),
            maxTurn: maxTurnIn(el),
            quietUntil: win.performance.now() + QUIET_MS,
            observer: null,
          }
          state.observer = new win.MutationObserver((records) => { onMutations(state, records) })
          state.observer.observe(el, { childList: true, subtree: true })
          states.set(el, state)
        }

        /** Bind every visible flow column and drop detached ones. */
        const scan = () => {
          const live = new Set()
          for (const el of doc.querySelectorAll('[data-chat-flow]')) {
            if (!(el instanceof win.Element)) continue
            if (el.clientWidth === 0 && el.clientHeight === 0) continue
            live.add(el)
            bindColumn(el)
          }
          for (const [el, state] of states) {
            if (live.has(el)) continue
            state.observer.disconnect()
            states.delete(el)
            clearSpace()
          }
          debug.columns = states.size
        }

        /** Coalesce structural checks to one per frame (streaming mutates a lot). */
        const scheduleScan = () => {
          if (scanFrame !== 0 || disposed) return
          scanFrame = win.requestAnimationFrame(() => {
            scanFrame = 0
            scan()
          })
        }

        ctx.effect(() => {
          const style = doc.createElement('style')
          style.setAttribute('data-chat-anchor-style', '')
          style.textContent = STYLE
          doc.head.appendChild(style)
          const rootObserver = new win.MutationObserver(scheduleScan)
          rootObserver.observe(doc.body, { childList: true, subtree: true })
          scan()
          return () => {
            disposed = true
            stopPin()
            clearSpace()
            rootObserver.disconnect()
            if (scanFrame !== 0) win.cancelAnimationFrame(scanFrame)
            for (const state of states.values()) state.observer.disconnect()
            states.clear()
            style.remove()
            debug.columns = 0
          }
        })

        // Invisible registration: proves this Client module applied in the live
        // page without adding any chrome, and disappears with the plugin.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'chat-anchor', order: 900, label: 'chat-anchor 1.7.0',
        }, () => null))
      },
    }
  },
})
