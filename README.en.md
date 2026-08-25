# dsh-token-bubbles

[中文](README.md) | English

A token visualizer plugin for the DeepSeek Harness web GUI: as tokens stream, small colored squares bubble up from the bottom-right corner, in order, 10/20 per row, each square representing 100/1000 tokens.

| Color | Meaning |
|---|---|
| 🟪 Magenta `#e446f9` | Output tokens (visible reply text) |
| 🟣 Dark purple `#5524a4` | Reasoning tokens |
| 🔵 Light blue `#79c4ff` | Input tokens (cache miss) |
| 🔵 Dark blue `#2d5cf6` | Input tokens (cache hit) |

Colors can be changed in the `COLORS` constant.

Every square goes through ONE FIFO queue and is released at the `revealIntervalMs` cadence. Each square always mounts into the slot closest to the bottom-right corner, so the grid always grows **bottom-up** for every color (the newest square sits at the bottom, older ones get pushed left and up; when a row completes, the whole grid glides up one cell with a 150ms animation). The queue is **never cleared mid-session** — squares from every step simply line up at the back — it only clears on session switch. The whole layer is `pointer-events: none`, so it **never blocks or intercepts the conversation**.

Two optional mechanisms (both enabled by default, see the config table):

- **Timeout disappearance**: after a square has been shown for `lifetimeMs`, the oldest squares dissolve in place — starting from the top row, left to right within each row, then row by row downward, paced by `expireIntervalMs`. While dissolving, **all other squares stay put**; the bottommost row always remains full and is the last to go. The grid effectively becomes a sliding time window.
- **Adaptive speed**: the longer the waiting queue, the more squares are released per tick (one extra square per `adaptiveStep` backlogged, capped at `adaptiveCap` per tick), so the display never falls too far behind.

When the on-screen count exceeds `maxSquares`, the topmost row is still evicted as a whole (with a leave animation) as a safety net.

There are two data sources:

- **Magenta (output) / dark purple (reasoning)**: estimated live — the plugin subscribes to the streaming `partial` blocks of the current session snapshot (4 characters ≈ 1 token), counting `text` and `reasoning` blocks separately, so squares queue up while the model is still writing, without waiting for end-of-call usage reporting.
- **Light blue (cache miss) / dark blue (cache hit)**: the token-meter's `tokenUsage` session projection (`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens`), pushed whenever each model call reports usage.

## Installation

### Option 1: install from GitHub (recommended)

```powershell
dsh plugin --profile web add github:Player047/dsh-token-bubbles
```

To pin a version, add a tag (replace with an actual repository tag):

```powershell
dsh plugin --profile web add github:Player047/dsh-token-bubbles#v0.4.5
```

### Option 2: local development (link install)

```powershell
git clone https://github.com/Player047/dsh-token-bubbles.git
dsh plugin --profile web add .\dsh-token-bubbles
```

Both options run pnpm inside the web profile directory and automatically append `dsh-token-bubbles` to `dsh.profile.bundles` (the package's `cordis.patch.yml` inserts a no-op host row whose only job is to make the client bundle served at `/plugins/dsh-token-bubbles/client.js`).

- **GitHub install** = copied into the profile; to tweak the config, edit `node_modules/dsh-token-bubbles/lib/client.js` inside your own profile, then restart.
- **link install** = points directly at your local source; edits take effect after a restart — best for development.

Restart the web profile to take effect:

```powershell
dsh web
```

(Exit the old process and start again; sessions are persisted, so conversations are not lost. Users without a web profile yet get one auto-initialized by `dsh plugin`.)

### Uninstall

```powershell
dsh plugin --profile web remove dsh-token-bubbles
```

Then restart `dsh web`.

## Configuration

All configuration lives in the `CFG` constant at the top of the client bundle; edit it and restart `dsh web` to apply:

| Key | Current value | Description |
|---|---|---|
| `tokensPerSquare` | `1000` | Tokens per square (`100` / `1000`) |
| `columns` | `20` | Squares per row (`10` / `20`) |
| `squareSize` / `gap` | `12` / `3` | Square size and gap (px) |
| `maxSquares` | `1100` | On-screen square cap; the topmost row is evicted as a whole (with a leave animation) when exceeded |
| `pendingCap` | `100000` | Soft cap of the waiting queue (guards against pathological backlog) |
| `batchCap` | `100000` | Max squares enqueued per usage update |
| `revealIntervalMs` | `1` | Display cadence: one tick every N ms |
| `timeoutEnable` | `true` | Timeout switch: when on, each square dissolves after `lifetimeMs`, oldest first |
| `lifetimeMs` | `20000` | How long a square stays visible (ms), used with `timeoutEnable` |
| `expireIntervalMs` | `10` | Dissolve cadence: let the oldest expired square leave every N ms |
| `adaptiveSpeed` | `true` | Adaptive speed switch: more backlog → more squares per tick |
| `adaptiveStep` | `100` | Backlog needed for one extra square per tick |
| `adaptiveCap` | `50` | Max squares released per tick |
| `charsPerToken` | `4` | Streaming-text heuristic: characters per estimated token |
| `corner` | `{right:16, bottom:16}` | Bottom-right corner margin |

## How it works

- Host side: the package mounts as one row in the composition (a no-op plugin), which is what makes `dsh-client-modules` inject `lib/client.js` into the boot manifest at `/plugins/dsh-token-bubbles/client.js?rev=…`.
- Client side: the bundle registers as a Cordis client plugin (`inject: ["slots", "sessions", "timer"]`) via `window.__ModuleLoader__` and mounts its component into `shell.overlay` (the frame-wide click-through layer).
- The component subscribes to `sessions.currentProvideInfo` for the current session; the `tokenUsage` projection face produces the blue squares (input/cache deltas), and the streaming `partial` of the session snapshot produces the dark-purple (reasoning) and magenta (output) squares (text folded at `charsPerToken`, queued while streaming). All squares flow through one FIFO queue released by the `timer` service at `revealIntervalMs`, so every color grows bottom-up; when the row cap is exceeded the topmost row leaves with an animation, and a session switch clears the screen and re-baselines.

## License

MIT
