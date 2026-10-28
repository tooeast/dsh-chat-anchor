中文 | [English](README.en.md)

# dsh-chat-anchor

**让 DeepSeek Harness 的网页聊天像 Codex 一样阅读：你刚发出的那条消息固定在聊天区顶部，回复向下生长，页面不再跟着滚到底部。**

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 它解决什么问题

dsh 的聊天区默认采用“跟随底部”策略：每次提交消息都会重新打开跟随，之后回复每长一点，整页就往下滚一点。长回复看到一半，自己刚问的那句话早就滚出视野了，只能手动往上拉——而下一条消息又会重置。

这个插件把交互反过来：

- 发送瞬间，你的消息就落到顶部；
- 回复在下面生长，视口保持不动；
- 需要看历史时正常往上滚，不会被抢回去。

## 功能

- **发送即锚定**：不等服务端回显。按发送的同一帧里，本地回声气泡就被放到顶部，所以不会出现“先掉到底部再跳上来”的闪动。
- **短回复也能顶住**：回复比屏幕短时，消息列会补出“刚好够”的底部空白，并随着回复变长按 1:1 收缩——没有多余空白可以滚进去，回复填满屏幕后留白自然归零。
- **不打扰阅读**：滚轮、触摸、点击或翻页键一碰就交还控制权；往上滚再滚回底部，布局不会塌、也不会跳。「回到底部」按钮照常可用。
- **干净收尾**：加载历史、切换会话不会误触发；切视图或禁用插件时，留白和监听都会释放。

## 安装

命令行：

```sh
dsh plugin add dsh-chat-anchor
```

或者网页端：**插件 → 添加**，搜索 `dsh-chat-anchor`。

非默认 profile 需要加 `--profile <名称>`，例如：

```sh
dsh plugin --profile web add dsh-chat-anchor
```

安装后**刷新页面**，浏览器才会加载新的客户端模块。不想用了，在同一个插件页禁用或卸载即可，不会改动 profile 里的其他配置。

## 环境要求

| 项 | 要求 |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0`（写在 `engines.dsh` 里） |
| 界面 | 网页 / 桌面版 Web UI（`dsh.client.platform: web`） |
| Host 半边 | 无——只有一个 patch 和一个客户端模块 |

插件 patch 只插入一行（`chat-anchor`），全部逻辑在 `client.js` 里；没有构建步骤，也没有运行时依赖。

## 工作原理

`@deepseek-ai/dsh-client-ui-chat` 自己拥有“跟随底部”的滚动策略，而且没有开关。所以插件借用聊天视图已经公开的 DOM 契约来工作：

| 属性 | 含义 |
|---|---|
| `[data-chat-flow]` | 滚动容器里的消息列 |
| `[data-chat-flow-kind="user"]` | 一条用户消息行 |
| `[data-chat-turn]` | 这条消息所属的轮次 |
| `[data-submission-echo]` | 发送时先渲染的本地回声 |
| `[data-chat-following-tail]` | 跟随底部时，聊天框架上会有这个属性 |

插件把消息行滚到距顶部 160px 的位置（上一条消息的尾巴露得更多），滚动用 450ms 缓动，不会一下跳过去，Chat 会把这次位移判定为“读者移动”，从而释放跟随意图。短回复所需的底部留白由消息列上的 `::after` 规则（`--chat-anchor-space` 变量）提供，位置在 sticky 输入框之前，所以输入框始终停在窗口底部。

具体行为和边界条件写在 [CHANGELOG](CHANGELOG.md) 和 [client.js](client.js) 的注释里。

## 已知限制

这是一个**客户端适配**，不是官方扩展点。它依赖上面这些 `data-chat-*` 属性——它们属于 `ui-chat` 内部实现，任何版本都可能改动。改动后插件会静默失效，不会让页面崩溃。如果某次 dsh 升级后锚定失灵，请带上 dsh 版本提 issue。

长期的正解在上游：给 `ui-chat` 加一个跟随模式偏好。可以直接提交的方案（英文 issue 正文 + 中文设计说明）在 [`upstream/`](upstream/README.md)。

## 排障

- **安装后没变化**：刷新页面，客户端模块是启动时加载的。
- **dsh 升级后失效**：多半是 DOM 契约变了。在浏览器控制台查看 `window.__dshChatAnchor`，它记录了版本、观察到的列、批次、回声、锚定次数和最近事件。
- **想关掉**：在插件页禁用或卸载 `dsh-chat-anchor`。

## 开发

没有构建步骤，`client.js` 就是最终产物。

```sh
npm run check   # 语法检查 Host 与 Client 两边
```

开发时把本目录作为本地 bundle 安装（和插件页的本地目录安装是同一个操作），每次修改后刷新页面。上游提案放在 [`upstream/`](upstream/README.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
