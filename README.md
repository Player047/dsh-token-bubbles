# dsh-token-bubbles

DeepSeek Harness web GUI 的 token 可视化插件：生成 token 时，右下角会冒出一个个彩色小方块，按顺序排列，每行 10/20 个，每个方块代表 100/1000 token。

| 颜色 | 含义 |
|---|---|
| 🟪 紫红 `#e446f9` | 输出 token（可见回复文本） |
| 🟣 深紫 `#5524a4` | 思考 token（reasoning） |
| 🔵 浅蓝 `#79c4ff` | 输入 token（缓存未命中） |
| 🔵 深蓝 `#2d5cf6` | 输入 token（缓存命中） |

颜色可在 `COLORS` 常量里改。

所有方块进入同一条 FIFO 队列，由定时器按 `revealIntervalMs` 的节奏逐个放出：每个方块上屏时都落在右下角最贴近角落的位置，所以无论哪种颜色，网格都**从下往上**生长（最新方块在最下，旧的被推向左侧和上方；换行时整块网格带 150ms 平滑上移动画）。队列**不会中途清空**——每一步产生的方块都排在队尾接着显示，只有切换会话时清屏。整层 `pointer-events: none`，**不会遮挡或阻挡对话操作**。

两个可选机制（都默认开启，见配置表）：

- **超时消失**：每个方块显示 `lifetimeMs` 后，从最老的开始溶解——从顶行开始、行内从左往右、逐行向下，节奏由 `expireIntervalMs` 控制。溶解时**其余方块原地不动**，最底下一行始终保持满员，直到上方全部消完才轮到它；网格自动变成时间窗口；
- **自适应速度**：等待队列越长，每 tick 放出的方块越多（积压每多 `adaptiveStep` 个多放 1 个，单 tick 上限 `adaptiveCap` 个），不会让显示等太久。

同屏数量超出 `maxSquares` 时仍会整行淘汰最顶上的一行（带离场动画），作为兜底。

数据来源有两个：

- **紫红（输出）/ 深紫（思考）**：实时估算——直接订阅当前会话快照的流式 `partial` 块（4 字符 ≈ 1 token），把 `text` 与 `reasoning` 两类块分开计数，模型一边写、方块就一边排队，不用等到模型调用结束的用量上报。
- **浅蓝（输入未命中）/ 深蓝（缓存命中）**：token-meter 的 `tokenUsage` 会话投影（`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens`），在每次模型调用上报用量时推送。

## 安装

### 方式一：从 GitHub 安装（推荐）

```powershell
dsh plugin --profile web add github:Player047/dsh-token-bubbles
```

想锁版本可以带 tag（按仓库实际 tag 替换）：

```powershell
dsh plugin --profile web add github:Player047/dsh-token-bubbles#v0.4.5
```

### 方式二：本地开发（link 安装）

```powershell
git clone https://github.com/Player047/dsh-token-bubbles.git
dsh plugin --profile web add .\dsh-token-bubbles
```

两种方式都会在 web profile 目录里执行 pnpm 安装，并把 `dsh-token-bubbles` 自动追加进 `dsh.profile.bundles`（包的 `cordis.patch.yml` 会插入宿主行，宿主行是 no-op，仅用于让客户端 bundle 被 `/plugins/dsh-token-bubbles/client.js` 提供）。

- **GitHub 安装** = 拷贝进 profile，改配置请改自己 profile 里的 `node_modules/dsh-token-bubbles/lib/client.js`，改完重启生效；
- **link 安装** = 直接指向本地源码，改源码后重启即可生效，适合开发迭代。

安装后**重启 web profile** 生效：

```powershell
dsh web
```

（旧进程退出后重新启动即可；会话有持久化，对话不会丢。还没有 web profile 的用户，`dsh plugin` 会自动初始化。）

### 卸载

```powershell
dsh plugin --profile web remove dsh-token-bubbles
```

然后重启 `dsh web`。

## 配置

客户端 bundle 顶部的 `CFG` 常量就是全部配置，改完重启 `dsh web` 生效：

| 键 | 当前值 | 说明 |
|---|---|---|
| `tokensPerSquare` | `1000` | 每个方块代表的 token 数（可选 `100` / `1000`） |
| `columns` | `20` | 每行方块数（可选 `10` / `20`） |
| `squareSize` / `gap` | `12` / `3` | 方块边长与间距（px） |
| `maxSquares` | `1100` | 屏幕上同时存在的方块数上限，超出时整行淘汰最顶上的一行（带离场动画，兜底） |
| `pendingCap` | `100000` | 待显示队列的软上限（防异常堆积） |
| `batchCap` | `100000` | 单次用量更新最多入队的方块数 |
| `revealIntervalMs` | `1` | 显示节奏：每多少 ms 一个 tick |
| `timeoutEnable` | `true` | 超时消失开关：开启后每个方块显示 `lifetimeMs` 后从最早的开始逐个消失 |
| `lifetimeMs` | `20000` | 方块显示时长（ms），配合 `timeoutEnable` |
| `expireIntervalMs` | `10` | 逐个消失的节奏：每多少 ms 让最老的 1 个过期方块离场 |
| `adaptiveSpeed` | `true` | 自适应速度开关：积压越多每 tick 放出越多 |
| `adaptiveStep` | `100` | 每积压多少方块，每 tick 多放 1 个 |
| `adaptiveCap` | `50` | 每 tick 最多放出的方块数 |
| `charsPerToken` | `4` | 流式文本估算：多少字符折合 1 token |
| `corner` | `{right:16, bottom:16}` | 右下角留白 |

## 工作原理

- 宿主侧：包被挂载为 composition 里的一行（no-op 插件），`dsh-client-modules` 据此把 `lib/client.js` 以 `/plugins/dsh-token-bubbles/client.js?rev=…` 注入启动清单。
- 客户端侧：bundle 通过 `window.__ModuleLoader__` 注册为 Cordis 客户端插件（`inject: ["slots", "sessions", "timer"]`），把可视化组件注册进 `shell.overlay`（框架级浮层，点击穿透）。
- 组件订阅 `sessions.currentProvideInfo` 拿到当前会话；`tokenUsage` 投影的可观察面产生蓝色方块（输入/缓存增量），会话快照的流式 `partial` 产生深紫（思考）与紫红（输出）方块（文本按 `charsPerToken` 折合，边写边排队）。所有方块都进入同一条 FIFO 队列，由 `timer` 服务按 `revealIntervalMs` 逐个放出，因此所有颜色都从右下角向上生长；超出行数上限时最顶上一行播放离场动画后移除，会话切换时清屏并重新建立基线。

## License

MIT
