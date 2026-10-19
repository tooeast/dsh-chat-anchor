# Changelog

## 1.7.0

First public release.

- Anchors each new prompt when it is submitted — on the local submission echo,
  before the durable record exists — instead of after the server echoes it.
- Keeps the anchored position for short answers by reserving only the minimum
  bottom room the scroll range needs; the room shrinks one-to-one as the answer
  grows and is removed once the answer is tall enough.
- Keeps that room when Chat re-engages tail following (for example after the
  reader scrolls up and back down), because at the minimal room the floor is
  the anchored position and following produces no movement.
- Hands control back on wheel, touch, pointer, or scroll keys; ignores history
  loads and session switches; cleans up when the column changes or the plugin
  is disabled.
- Adds a hidden diagnostic record on `window.__dshChatAnchor`.
