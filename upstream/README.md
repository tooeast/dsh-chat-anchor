# Upstream proposal: a follow-mode preference for the Chat transcript

This directory holds a change proposal for
[`@deepseek-ai/dsh-client-ui-chat`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-chat),
prepared against the sources at tag **`dsh-v0.2.1-rc.2`** (the version the
desktop app in this session ships).

| File | Purpose |
|---|---|
| `PROPOSAL.en.md` | Issue/PR-ready description, design, implementation sketch, test plan |
| `PROPOSAL.zh.md` | Same in Chinese, for review with the user's team |

## Why a proposal and not a ready PR

The behavior this proposes is not a bug fix with an obvious diff: it changes
the scroll-ownership policy of the Chat target, adds a Host-backed preference,
and needs the repository's build and browser-scenario tooling to verify. That
tooling is not available in this environment:

- the installed app ships the built Client bundle inside `app.asar`, so there
  is no writable source checkout of dsh here;
- the proposal therefore contains exact file paths, functions, code sketches,
  and tests, not a pre-built patch.

The working stopgap (a Client plugin that anchors the prompt through the
transcript's DOM contract) lives one directory up in
[`dsh-chat-anchor`](../README.md). It is evidence that the interaction is
useful, and it is also the reason for proposing a first-class preference: the
plugin depends on internal `data-chat-*` attributes and would break silently
on any refactor of the Chat target.

## Suggested submission

1. Open an issue in `deepseek-ai/deepseek-harness` with `PROPOSAL.en.md`
   (title: *Chat: add a follow-mode preference (`tail` | `anchor`)*).
2. If the maintainers accept the shape, split the change into the two commits
   sketched there (preference plumbing first, behavior second).
3. Build and verify with the repository's own tooling:
   `pnpm install`, `pnpm --filter @deepseek-ai/dsh-client-ui-chat test`,
   `pnpm run dev:web` for the browser scenarios.

No upstream code was modified from this environment.
