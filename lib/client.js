/**
 * dsh-token-bubbles — client bundle (browser half).
 *
 * Served by the host at /plugins/dsh-token-bubbles/client.js and executed
 * through window.__ModuleLoader__; only the shell seed words ("react",
 * "react/jsx-runtime", primitives) may be require()d. The module exports a
 * Cordis client plugin that mounts a click-through visualization into the
 * frame-wide `shell.overlay` slot.
 *
 * Data sources:
 *  - magenta (output) / dark purple (reasoning): LIVE — estimated from the
 *    streaming assistant text of the current session snapshot with a
 *    language-adaptive heuristic (CJK ≈ 1.2 chars/token, other ≈ 4, both
 *    calibrated against real provider usage), and reconciled against the
 *    official per-call usage when it arrives (calibrateWithUsage).
 *  - light blue (uncached input) / dark blue (cache hit): the `tokenUsage`
 *    session projection (uncachedInputTokens / cacheReadTokens /
 *    cacheWriteTokens), updated when each model call reports usage.
 *
 * Display: every square goes through ONE FIFO queue and is revealed at
 * revealIntervalMs — a square always mounts into the bottom-right corner
 * slot, so the grid always grows bottom-up for every color. The queue is
 * never cleared mid-session (only on session switch). Optional behaviors:
 * timeout disappearance (squares leave one by one after lifetimeMs, oldest
 * first) and adaptive reveal speed (more backlog -> more squares per tick);
 * the row-cap eviction remains as a safety net.
 */
window.__ModuleLoader__.load({
	id: "dsh-token-bubbles",
	factory: (require) => {
		const bundleModule = { exports: {} };
		Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		// ── 可调配置（改完重启 dsh web 生效）─────────────────────────────
		const CFG = {
			// 输入系（未缓存输入 + 缓存命中）每个小方块代表的 token 数
			inputTokensPerSquare: 1000,
			// 输出系（正文 + 思考）每个小方块代表的 token 数
			// 可与输入分开设置：调小让输出方块更密（例如输入 1000 / 输出 100）
			outputTokensPerSquare: 10,
			// 每行方块数：10 或 20
			columns: 20,
			// 方块边长（px）
			squareSize: 12,
			// 方块间距（px）
			gap: 3,
			// 屏幕上同时存在的方块数上限（超出时整行淘汰最顶上一行）
			maxSquares: 1100,
			// 待显示队列的软上限（防止异常堆积；正常使用到不了）
			pendingCap: 100000,
			// 单次用量更新最多新增的方块数
			batchCap: 100000,
			// 队列固定显示速度：每多少 ms 放出一个方块（tick 间隔）
			revealIntervalMs: 1,
			// ── 可选功能 ──────────────────────────────────────────────
			// 超时消失：开启后每个方块显示 lifetimeMs 后，从最早的开始
			// 从上往下「一个一个」消失（而不是一行一行）
			timeoutEnable: true,
			lifetimeMs: 20000,
			// 逐个消失的节奏：每多少 ms 让最老的 1 个过期方块离场（与 tick 解耦）
			expireIntervalMs: 10,
			// 自适应速度：等待队列越长，每 tick 放出的方块越多，避免积压等太久
			adaptiveSpeed: true,
			// 每积压 adaptiveStep 个，每 tick 多放 1 个；每 tick 最多 adaptiveCap 个
			adaptiveStep: 100,
			adaptiveCap: 50,
			// ── 流式文本估算（语言自适应，常数由官方 usage 标定）───────
			// 每 token 的字符数：CJK ≈ 1.2、英文/代码等 ≈ 4（思考实测 ≈3.9）
			cjkCharsPerToken: 1.2,
			otherCharsPerToken: 4,
			// 官方校准：每次模型调用结束时，用官方 outputTokens 对账，
			// 差额按估算比例补发/回扣方块（把总数校准到官方真值）
			calibrateWithUsage: true,
			// 右下角留白（px）
			corner: { right: 16, bottom: 16 },
		};
		const COLORS = {
			output: "#e446f9", // 输出：紫红
			reasoning: "#5524a4", // 思考：深紫
			input: "#79c4ff", // 输入（缓存未命中）：浅蓝
			cache: "#2d5cf6", // 缓存命中：深蓝
		};

		// ── 样式（一次性注入，带 plugin 标记便于宿主追踪）────────────────
		// 单容器 + 绝对定位 + 容器 transform 抬升：
		// 每个方块的 left/bornRow 上屏后冻结，换行抬升统一由容器的
		// translateY 表达（一个元素一个属性），换行动画走 transform 过渡。
		// 注意：不要给方块的 left/bottom 加 transition —— 高 tick 频率下
		// 过渡会被反复中断重启导致位置重叠（曾经的“爆炸”bug）。
		const cell = CFG.squareSize + CFG.gap;
		const maxRows = Math.ceil(CFG.maxSquares / CFG.columns);
		const css = [
			`.TB_root{position:fixed;right:${CFG.corner.right}px;bottom:${CFG.corner.bottom}px;pointer-events:none;z-index:10;transition:transform 150ms ease-out}`,
			`.TB_sq{position:absolute;width:${CFG.squareSize}px;height:${CFG.squareSize}px;border-radius:3px}`,
			`.TB_sq-output{background:${COLORS.output};box-shadow:0 0 6px ${COLORS.output}66}`,
			`.TB_sq-reasoning{background:${COLORS.reasoning};box-shadow:0 0 6px ${COLORS.reasoning}66}`,
			`.TB_sq-input{background:${COLORS.input};box-shadow:0 0 6px ${COLORS.input}66}`,
			`.TB_sq-cache{background:${COLORS.cache};box-shadow:0 0 6px ${COLORS.cache}66}`,
			`@keyframes tb-pop{from{transform:translateY(10px) scale(0);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}`,
			`@keyframes tb-leave{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-8px) scale(.4)}}`,
		].join("");
		const tagId = "dsh-token-bubbles/TokenBubbles.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-token-bubbles";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── 工具 ──────────────────────────────────────────────────────
		const ABSENT = { getSnapshot: () => undefined, subscribe: () => () => {} };

		/** 把一个 { getSnapshot, subscribe } 可观察对象变成 React 状态。 */
		function useObservable(source) {
			return React.useSyncExternalStore(
				React.useCallback((cb) => source.subscribe(cb), [source]),
				React.useCallback(() => source.getSnapshot(), [source]),
				React.useCallback(() => source.getSnapshot(), [source]),
			);
		}

		/** CJK 字符判断（含 CJK 扩展与全角标点）。 */
		function isCJKChar(ch) {
			const c = ch.codePointAt(0);
			return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3000 && c <= 0x303f);
		}

		/** 流式 partial 的字符数，按块类型与语言分开：{ text:{cjk,other}, reasoning:{cjk,other} }。 */
		function streamCountsOf(partial) {
			const zero = () => ({ cjk: 0, other: 0 });
			const counts = { text: zero(), reasoning: zero() };
			if (partial === undefined || partial === null) return counts;
			const blocks = partial.blocks;
			if (!Array.isArray(blocks)) return counts;
			for (const block of blocks) {
				if (block === null || typeof block !== "object") continue;
				if (block.kind !== "text" && block.kind !== "reasoning") continue;
				if (typeof block.text !== "string") continue;
				const bucket = counts[block.kind];
				for (const ch of block.text) {
					if (isCJKChar(ch)) bucket.cjk++;
					else bucket.other++;
				}
			}
			return counts;
		}

		// ── 组件 ──────────────────────────────────────────────────────
		function TokenBubbles(props) {
			const { sessions, timer } = props;
			const [squares, setSquares] = React.useState([]);
			// 离场中的方块（被淘汰的整行）：按旧位置渲染，播完 tb-leave 后移除
			const [leaving, setLeaving] = React.useState([]);

			// 当前会话的 provide 投影：sessionId + 随会话切换的 projections face
			const info = useObservable(sessions.currentProvideInfo);
			const sessionId = info?.sessionId;
			const face = info?.projections?.faceOf?.("tokenUsage");
			const usage = useObservable(face ?? ABSENT);
			// 当前会话快照：partial 携带流式文本，逐 chunk 更新
			const sessionObs = sessionId === undefined ? undefined : sessions.binding(sessionId)?.session;
			const snap = useObservable(sessionObs ?? ABSENT);

			const usagePrevRef = React.useRef(undefined);
			const usageAccRef = React.useRef({ input: 0, cache: 0 });
			const streamPrevRef = React.useRef(undefined);
			const streamAccRef = React.useRef({ text: 0, reasoning: 0 });
			const estRef = React.useRef({ text: 0, reasoning: 0 });
			const pendingRef = React.useRef([]);
			const squaresRef = React.useRef([]);
			const nextIdRef = React.useRef(1);
			const lastExpireRef = React.useRef(0);
			const cursorRef = React.useRef({ nextLeft: 0 });
			const gridRowsRef = React.useRef(0);
			const [gridRows, setGridRowsState] = React.useState(0);
			// 换行计数：唯一会改变已有方块视觉位置的东西，由容器 transform 承载
			const setGridRows = (value) => {
				gridRowsRef.current = value;
				setGridRowsState(value);
			};
			const sessionRef = React.useRef(sessionId);

			// 把一批方块放进 FIFO 队列尾部（不直接上屏）
			const enqueue = (groups) => {
				const pending = pendingRef.current;
				for (const group of groups) {
					if (!(group.count > 0)) continue;
					for (let i = 0; i < group.count; i++) {
						pending.push({ id: nextIdRef.current++, kind: group.kind });
					}
				}
				if (pending.length > CFG.pendingCap) pending.splice(0, pending.length - CFG.pendingCap);
			};

			// 把方块依次放进网格：光标沿右下角行、行内从左往右推进。
			// 每个方块记录出生行 bornRow；一行放满后 gridRows+1，所有已出生
			// 方块的视觉位置随容器 transform 整体上移（见渲染处），因此
			// 溶解只摘掉它自己、其余原地不动，换行抬升则带 150ms 平滑过渡。
			const placeSquares = (merged, items, now) => {
				const cursor = cursorRef.current;
				let rows = gridRowsRef.current;
				let out = merged;
				for (const p of items) {
					const sq = { id: p.id, kind: p.kind, born: now, left: cursor.nextLeft, bornRow: rows };
					out = out.concat([sq]);
					cursor.nextLeft += cell;
					if (cursor.nextLeft >= CFG.columns * cell) {
						cursor.nextLeft = 0;
						rows += 1;
					}
				}
				if (rows !== gridRowsRef.current) setGridRows(rows);
				return out;
			};

			// 每个 tick（revealIntervalMs）推进一次：
			// 1) 清理播完离场动画的方块
			// 2) 超时消失（可选）：最老的方块到期后原地溶解——从顶行开始、
			//    行内从左往右、逐行向下，其余方块不动，最底下一行始终满员
			// 3) 从 FIFO 队列放出方块（可选自适应：积压越多放得越快）
			// 4) 行数上限：从最顶上一层整层淘汰（带离场动画）
			const advance = () => {
				const now = Date.now();
				setLeaving((prev) => {
					const alive = prev.filter((l) => now - l.leaveAt < 320);
					return alive.length === prev.length ? prev : alive;
				});
				const pending = pendingRef.current;
				const current = squaresRef.current;
				const departures = [];
				let merged = current;

				// 超时消失：按 expireIntervalMs 的节奏，让最老的 1 个过期方块原地溶解
				if (CFG.timeoutEnable && merged.length > 0 && now - lastExpireRef.current >= CFG.expireIntervalMs) {
					const oldest = merged[0];
					if (oldest.born !== undefined && now - oldest.born >= CFG.lifetimeMs) {
						lastExpireRef.current = now;
						departures.push({
							id: oldest.id,
							kind: oldest.kind,
							left: oldest.left,
							bornRow: oldest.bornRow,
							leaveAt: now,
						});
						merged = merged.slice(1);
						if (merged.length === 0) {
							// 全空后从头排
							cursorRef.current.nextLeft = 0;
							setGridRows(0);
						}
					}
				}

				// 放出方块：自适应速度 = 1 + 积压/adaptiveStep，上限 adaptiveCap
				if (pending.length > 0) {
					let count = 1;
					if (CFG.adaptiveSpeed) {
						count = Math.min(CFG.adaptiveCap, 1 + Math.floor(pending.length / CFG.adaptiveStep));
					}
					count = Math.min(count, pending.length);
					merged = placeSquares(merged, pending.splice(0, count), now);
				}

				// 行数上限：从最顶上一层（最小 bornRow）整层淘汰（带离场动画）
				if (merged.length > 0) {
					let minBornRow = Infinity;
					for (const s of merged) if (s.bornRow < minBornRow) minBornRow = s.bornRow;
					if (gridRowsRef.current - minBornRow + 1 > maxRows) {
						const removed = merged.filter((s) => s.bornRow === minBornRow);
						merged = merged.filter((s) => s.bornRow !== minBornRow);
						for (const sq of removed) {
							departures.push({
								id: sq.id,
								kind: sq.kind,
								left: sq.left,
								bornRow: sq.bornRow,
								leaveAt: now,
							});
						}
					}
				}

				if (merged !== current) {
					squaresRef.current = merged;
					setSquares(merged);
				}
				if (departures.length > 0) setLeaving((prev) => prev.concat(departures));
			};

			// 无 timer 时的退化路径：整条队列立即上屏（同样套用行数上限）
			const flushAll = () => {
				const pending = pendingRef.current;
				if (pending.length === 0) return;
				const batch = pending.splice(0, pending.length);
				let merged = placeSquares(squaresRef.current, batch, Date.now());
				// 行数上限兜底：从最顶上一层整层移除
				while (merged.length > 0) {
					let minBornRow = Infinity;
					for (const s of merged) if (s.bornRow < minBornRow) minBornRow = s.bornRow;
					if (gridRowsRef.current - minBornRow + 1 <= maxRows) break;
					merged = merged.filter((s) => s.bornRow !== minBornRow);
				}
				squaresRef.current = merged;
				setSquares(merged);
			};

			// 定时器驱动显示节奏；timer 缺失时退化为即时上屏
			React.useEffect(() => {
				if (timer === undefined) return;
				const dispose = timer.interval(() => advance(), CFG.revealIntervalMs);
				return () => dispose?.();
			}, [timer]);

			// 会话切换：清屏并清空队列、重新建立基线（旧会话总量不算增量）
			React.useEffect(() => {
				if (sessionRef.current === sessionId) return;
				sessionRef.current = sessionId;
				usagePrevRef.current = undefined;
				usageAccRef.current = { input: 0, cache: 0 };
				streamPrevRef.current = undefined;
				streamAccRef.current = { text: 0, reasoning: 0 };
				estRef.current = { text: 0, reasoning: 0 };
				pendingRef.current = [];
				squaresRef.current = [];
				lastExpireRef.current = 0;
				cursorRef.current = { nextLeft: 0 };
				setGridRows(0);
				setSquares([]);
				setLeaving([]);
			}, [sessionId]);

			// 用量增量 → 蓝色方块入队 + 官方输出校准（可选）
			React.useEffect(() => {
				if (sessionId === undefined) return;
				const prev = usagePrevRef.current;
				usagePrevRef.current = usage;
				if (prev === undefined || prev === null || usage === undefined || usage === null) return;
				const groups = [];
				const inputDelta = Math.max(0, ((usage.uncachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) - ((prev.uncachedInputTokens ?? 0) + (prev.cacheWriteTokens ?? 0)));
				const cacheDelta = Math.max(0, (usage.cacheReadTokens ?? 0) - (prev.cacheReadTokens ?? 0));
				const outputDelta = Math.max(0, (usage.outputTokens ?? 0) - (prev.outputTokens ?? 0));
				const acc = usageAccRef.current;
				if (inputDelta > 0) acc.input += inputDelta;
				if (cacheDelta > 0) acc.cache += cacheDelta;
				let budget = CFG.batchCap;
				for (const kind of ["input", "cache"]) {
					const count = Math.min(budget, Math.floor(acc[kind] / CFG.inputTokensPerSquare));
					acc[kind] -= count * CFG.inputTokensPerSquare;
					budget -= count;
					if (count > 0) groups.push({ kind, count });
				}
				// C：官方 outputTokens（含思考）与流式估算对账，差额补发/回扣
				if (CFG.calibrateWithUsage && outputDelta > 0) {
					const est = estRef.current;
					const estTotal = est.text + est.reasoning;
					if (estTotal > 0) {
						const diff = outputDelta - estTotal;
						const textShare = est.text / estTotal;
						const sAcc = streamAccRef.current;
						sAcc.text += diff * textShare;
						sAcc.reasoning += diff * (1 - textShare);
						if (sAcc.text < 0) sAcc.text = 0;
						if (sAcc.reasoning < 0) sAcc.reasoning = 0;
						for (const pair of [["text", "output"], ["reasoning", "reasoning"]]) {
							const count = Math.min(CFG.batchCap, Math.floor(sAcc[pair[0]] / CFG.outputTokensPerSquare));
							sAcc[pair[0]] -= count * CFG.outputTokensPerSquare;
							if (count > 0) groups.push({ kind: pair[1], count });
						}
					}
					estRef.current = { text: 0, reasoning: 0 };
				}
				enqueue(groups);
				if (timer === undefined) flushAll();
			}, [usage, sessionId]);

			// 流式文本增量 → 思考（深紫）与输出（紫红）方块入队；思考先写、先入队。
			// 估算 = CJK/1.2 + 其他/4（语言自适应），单位是「估算 token」，
			// 方块 = 估算 token ÷ outputTokensPerSquare；余数保留到下次。
			React.useEffect(() => {
				if (sessionId === undefined) return;
				const counts = streamCountsOf(snap?.partial);
				const prev = streamPrevRef.current;
				streamPrevRef.current = counts;
				if (prev === undefined) return;
				const acc = streamAccRef.current;
				const est = estRef.current;
				for (const kind of ["reasoning", "text"]) {
					const before = prev[kind];
					const after = counts[kind];
					if (after.cjk < before.cjk || after.other < before.other) {
						// 新一轮/新步骤开始（partial 清零）：重置余数
						acc[kind] = 0;
					}
					const dCjk = Math.max(0, after.cjk - before.cjk);
					const dOther = Math.max(0, after.other - before.other);
					if (dCjk + dOther === 0) continue;
					const tokens = dCjk / CFG.cjkCharsPerToken + dOther / CFG.otherCharsPerToken;
					acc[kind] += tokens;
					est[kind] += tokens;
				}
				const groups = [];
				for (const kind of ["reasoning", "text"]) {
					const count = Math.min(CFG.batchCap, Math.floor(acc[kind] / CFG.outputTokensPerSquare));
					acc[kind] -= count * CFG.outputTokensPerSquare;
					if (count > 0) groups.push({ kind: kind === "text" ? "output" : "reasoning", count });
				}
				enqueue(groups);
				if (timer === undefined) flushAll();
			}, [snap, sessionId]);

			// 单容器绝对定位布局：每个方块的 left/bornRow 在出队时冻结；
			// 视觉位置 = 容器 translateY(-gridRows*cell)（负值向上抬升）
			// + 冻结的 -bornRow*cell，换行抬升由容器的 transform 过渡平滑完成。
			const elements = React.useMemo(() => {
				if (squares.length === 0) return null;
				const live = squares.map((sq) =>
					React.createElement("span", {
						key: sq.id,
						className: "TB_sq TB_sq-" + sq.kind,
						style: {
							left: sq.left + "px",
							bottom: -(sq.bornRow) * cell + "px",
							animation: "tb-pop 240ms cubic-bezier(.2,.9,.3,1.4) both",
						},
					}),
				);
				const departing = leaving.map((l) =>
					React.createElement("span", {
						key: "leave-" + l.id,
						className: "TB_sq TB_sq-" + l.kind,
						style: {
							left: l.left + "px",
							bottom: -(l.bornRow) * cell + "px",
							animation: "tb-leave 300ms ease-in forwards",
						},
					}),
				);
				return React.createElement(
					"div",
					{
						className: "TB_root",
						"aria-hidden": "true",
						style: {
							width: CFG.columns * cell - CFG.gap + "px",
							height: CFG.squareSize + "px",
							// 注意负号：translateY 正值向下，抬升必须用负值
							transform: "translateY(-" + gridRows * cell + "px)",
						},
					},
					live.concat(departing),
				);
			}, [squares, leaving, gridRows]);
			return elements;
		}

		// ── Cordis 客户端插件体 ───────────────────────────────────────
		const inject = ["slots", "sessions", "timer"];
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{ name: "shell.overlay", id: "token-bubbles", order: 900, label: "Token bubbles" },
					() => React.createElement(TokenBubbles, { sessions: ctx.sessions, timer: ctx.timer }),
				),
			);
		}

		bundleModule.exports.apply = apply;
		bundleModule.exports.inject = inject;
		return bundleModule.exports;
	},
});
