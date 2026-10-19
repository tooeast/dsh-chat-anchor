# 上游改动方案：聊天跟随模式偏好（`tail` | `anchor`）

**目标包：** `@deepseek-ai/dsh-client-ui-chat`
**基线：** `dsh-v0.2.1-rc.2`（当前桌面版内置的版本）
**状态：** 设计 + 代码级方案，未构建、未测试。基于该 tag 的真实源码整理；
编写环境中没有可写的 dsh 源码仓库，也没有它的构建/浏览器场景工具链。

> 代码块与逐文件说明见英文版 [`PROPOSAL.en.md`](PROPOSAL.en.md)；本文说明
> 设计取舍与验收标准。

## 问题

提交消息时，`use-chat-scroll.ts` 的 `processContent()` 把新输入当作
`ownInput`，调用 `reading.followTail()`；此后每次内容提交都继续把滚动口钉在
底部（`tipChanged && reading.followingTail`）。于是流式回复期间整个对话一直在
往上滚，刚发的那条消息很快滚出视野。

终端类 Agent（Codex 等）是反过来的：提问停在可见区域顶部，回复向下生长，
读者的注意力不用被页面拖着走。

当前 `ui-chat` 只有 `transcriptView`、`collapseTiming`、`performanceUsage`、
`linkOpening` 四个偏好，没有控制跟随策略的配置、Slot 或 Client 服务，所以只能
每次手动往上滚，而下一次提交又会重置。

## 方案

新增一个 Chat 偏好：

| 字段 | 取值 | 默认 |
|---|---|---|
| `ui-chat.follow` | `tail`（现有行为）· `anchor` | `tail` |

`anchor` 模式下的交互：

1. **提交瞬间**把新提问行放到滚动区顶部（距顶 16px），并释放跟随；先瞄准本地
   回声气泡，正式消息行到达后接管。
2. **流式期间**不跟随，回复在下方生长。
3. **底部留白**：回复比视口短时，消息列补出「刚好够顶住」的空白
   `max(0, anchorTop + viewportHeight − contentHeight)`，随回复增长按 1:1 收缩，
   因此没有多余空白可滚进去。留白位于 sticky 输入框之前，输入框保持在窗口底部。
4. **滚动手势**交还控制权；留白保留，滚回底部不会触发布局跳动。
5. **「回到底部」按钮**清掉留白并恢复跟随。
6. **下一条提问**重新锚定；切会话、切视图时重置。

默认值保持 `tail`，不改变现有用户的行为。

## 改动清单

**提交一：偏好接入（不改行为）**

| 文件 | 改动 |
|---|---|
| `src/chat-settings.ts` | 新增 `FOLLOW_MODES`、`FollowMode`、`DEFAULT_FOLLOW`、`ChatSettings.follow`、schema 字段（默认 `tail`） |
| `src/client/presentation-policy.ts` | `ChatPresentationPolicy` 增加 `follow`；`presentationPolicyFor` / `derivePresentationPolicy` 增加第三个入参，并用缓存保持对象引用稳定（现有注释要求同一选择返回同一对象） |
| `src/client/apply.ts` | 仿照 `linkOpening` 建 follow store；`derivePresentationPolicy(..., follow)`；扩展 `transcript-view` 行的注入面（`follow` / `setFollow`） |
| `src/client/settings/TranscriptViewRow.tsx` | 在「工作详情 / 折叠时机」旁增加第三个 `PreferenceRow` |
| `src/client/locale.ts` | 新增四条文案（中英） |

**提交二：锚定行为**

| 文件 | 改动 |
|---|---|
| `src/client/chat/ChatView.tsx` | 读取 `policy.follow` 传入 `useChatScroll`；在 flow 之后、消息列内渲染留白元素 |
| `src/client/chat/ChatView.module.css` | `.anchorRoom { flex: none; pointer-events: none }` |
| `src/client/chat/use-chat-scroll.ts` | `ownInput` 分支：`anchor` 模式优先尝试 `reading.anchorInput(lastKey)` |
| `src/client/chat/use-chat-reading.ts` | 新增 `anchorInput(nodeKey)`：调用 viewport 锚定，提交 `followingTail: false`，保存位置 |
| `src/client/chat/use-chat-viewport.ts` | 新增 `anchorRow(nodeKey)` 与留白尺寸计算；复用现有 `anchor()` / `align()`；用消息列的 `ResizeObserver` 在回复增长时收缩留白 |

关键点：**不复用 fold 的 `turnSpacer`**。它由折叠策略回收（`reclaimBelow`），
语义与「锚定留白」冲突；留白必须是独立的列内元素。

## 测试点

单元：

- `presentationPolicyFor(mode, timing, follow)` 同一三元组返回同一对象；
  不同 `follow` 返回不同对象。
- `ChatSettingsSchema`：接受 `anchor`、拒绝未知值、缺省字段解析为 `tail`
  （覆盖旧设置文档）。
- `ChatReading.anchorInput` 发布 `followingTail: false` 且写入位置。
- `useChatScroll` 在 `follow === 'anchor'` 且末行是用户行时走 `anchorInput`。

浏览器场景：

1. 短会话发送：提交后第一帧提问就在距顶 16px 处，没有先掉到底部的闪烁。
2. 流式长回复：视口不动，留白降到 0。
3. 流式中往上滚再回到底部：布局不跳，留白仍在需要时保留。
4. 点「回到底部」：清留白并恢复跟随。
5. 锚定期间切会话/切视图：没有残留留白或监听。
6. 折叠时机 `next-input`、减少动态效果：锚定结果一致。

## 兼容性与风险

- 纯增量：新字段带默认值，无需迁移；旧设置缺字段即 `tail`。
- 风险集中在留白：它会改变滚动范围。需要确保留白不参与历史分页的锚点补偿，
  并且在切视图、卸载时释放；这些点已在方案中列出。
- `derivePresentationPolicy` 的签名变化会影响现有调用与测试，属于机械改动。

## 建议提交方式

1. 在 `deepseek-ai/deepseek-harness` 开 issue，正文用 `PROPOSAL.en.md`
   （标题建议：*Chat: add a follow-mode preference (`tail` | `anchor`)*）。
2. 维护者认可方向后，按上面两个提交拆分实现。
3. 用仓库自身工具验证：`pnpm install`、
   `pnpm --filter @deepseek-ai/dsh-client-ui-chat test`、
   `pnpm run dev:web` 跑浏览器场景。

当前目录下的插件 [`dsh-chat-anchor`](../README.md) 是同一交互的临时实现，
也是本提案可用性的证据；但它依赖 `data-chat-*` 内部属性，官方重构后会静默
失效——这正是本提案要消除的部分。
