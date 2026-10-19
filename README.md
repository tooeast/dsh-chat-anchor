# dsh-chat-anchor

**Codex-style reading for the DeepSeek Harness Web chat: the prompt you just
sent stays at the top of the transcript and the answer grows downward, instead
of the page following the bottom of every streamed reply.**

你的提问固定在聊天区顶部，回复向下生长，页面不再跟着滚动。

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it does

- **Anchors on send**, not after the server round-trip: the local submission
  echo is placed at the top of the transcript in the same task, before the
  browser paints, so the prompt never flashes at the bottom first.
- **Keeps the position** while the answer streams; the viewport does not move.
- **Short answers still anchor**: the message column reserves exactly the bottom
  room the scroll range needs, and that room shrinks one-to-one as the answer
  grows. There is no extra blank to scroll into, and the room disappears once
  the answer fills the screen.
- **You stay in control**: wheel, touch, pointer-down, or a scroll key hands the
  viewport back. Scrolling up and back down does not collapse the layout. The
  shipped *back-to-bottom* button keeps working.
- **Clean scope**: history loads and session switches are ignored; the room and
  observers are released when the view changes or the plugin is disabled.

## Install

From the dsh CLI:

```sh
dsh plugin add dsh-chat-anchor
```

Or in the Web UI: **Plugins → Add**, search/enter `dsh-chat-anchor`.

Non-default profiles take `--profile <name>`, for example
`dsh plugin --profile web add dsh-chat-anchor`.

After installing, **reload the page** so the browser loads the new Client
module. Disable or remove the bundle from the same Plugins page to return to the
shipped behaviour; nothing else in the profile is touched.

## Requirements

| | |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0` (declared as `engines.dsh`) |
| Surface | Web / Desktop Web UI (`dsh.client.platform: web`) |
| Host half | none — a patch-only bundle plus a Client module |

The bundle's patch inserts one row (`chat-anchor`) and the Client module does
all the work; there is no Host plugin, no build step, and no runtime dependency.

## How it works

`@deepseek-ai/dsh-client-ui-chat` owns a bottom-follow policy: every submitted
input re-enables tail following, and every later content commit keeps the
scrollport on the floor. There is no setting for it, so this plugin works with
the transcript the way a reader would, using the DOM contract the Chat view
already publishes:

| Attribute | Meaning |
|---|---|
| `[data-chat-flow]` | the message column inside the transcript scrollport |
| `[data-chat-flow-kind="user"]` | one human row |
| `[data-chat-turn]` | the turn that row belongs to |
| `[data-submission-echo]` | the local echo rendered on send |
| `[data-chat-following-tail]` | present on the frame while tail following is on |

It scrolls the row to the top of the scrollport (16px clearance). Chat
attributes scroll movement against its last acknowledged position, so the move
reads as reader movement and its sampling interval releases the follow intent.
A `::after` rule on the column (driven by `--chat-anchor-space`) supplies the
minimum bottom room a short answer needs; the room sits before the sticky
composer, so the composer keeps its place at the window foot.

The exact behaviour, edge cases, and the measurement algebra are documented in
[the changelog](CHANGELOG.md) and in the source comments of
[`client.js`](client.js).

## Limits

This is a Client-side adapter, not an official extension point. It depends on
the `data-chat-*` attributes above, which are internal to `ui-chat` and may
change in any release; when they do, the plugin fails silently rather than
crashing. If a dsh update breaks the anchoring, open an issue with the dsh
version.

The clean fix belongs upstream: a follow-mode preference in `ui-chat`. The
ready-to-submit proposal lives in [`upstream/`](upstream/README.md) (English
issue text and a Chinese design note).

## Troubleshooting

- **Nothing changed after install**: reload the page; the Client module is
  fetched at boot.
- **Stopped working after a dsh update**: the DOM contract probably changed.
  Check `window.__dshChatAnchor` in the browser console — it records the version,
  observed columns, batches, journal additions, pins, and the last events.
- **Disable it**: turn off or remove `dsh-chat-anchor` in the Plugins page.

## Development

No build step: `client.js` is the shipped browser module.

```sh
npm run check   # syntax-check both halves
```

Install a checkout as a local bundle (the same local-directory install the
Plugins page performs) and reload the page after each edit. The upstream
proposal for a first-class setting is kept in [`upstream/`](upstream/README.md).

## License

MIT — see [LICENSE](LICENSE).
