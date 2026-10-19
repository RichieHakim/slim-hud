// slim-hud: what fills the context window, as one thin line under the status line.
//   Adapted from Hamza Zafar's context-bar (MIT; github.com/hamzafer/claude-code-mods, commit 77f1ebc).
//   It draws in the hint line's site (PromptHint), which the terminal paints on the bottom rows,
//   under a statusLine command's rows and under the engine's own hint, which stays. By default one
//   line: a stacked bar, a color per /context category, then the tokens in use. /ctx, a click on the
//   line, or ctrl+x b adds a legend; the choice is kept across sessions.
//   Under it, the model, its effort and the session's age as claude-hud's first line shows them, then
//   the 5-hour and 7-day rate limits as claude-hud's stacked usage bar draws them, then the todo in progress.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Limit, Reading, Slice, Todo } from '../types'

// 40 cells: every used category takes at least one cell, so on a 1M window the five small ones
// always cost five cells (125k of apparent use). At 40 that is 1/8 of the bar; at claude-hud's 10
// it would be half. Past ~48 cells rounding stops buying accuracy, and 40 plus "184k" fits 60 columns.
const BAR_CELLS = 40
const MIN_BAR = 8 // with less room than this, only the token count is drawn
const MARGIN = 4 // the engine draws this site's rows two cells in and keeps two free at the right
const SPLIT = '  '
// /context's theme gives several rows the same grey, so each used row gets its own color, in order.
const PALETTE = ['#7aa2f7', '#7dcfff', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64', '#c0caf5']
const MESSAGES = '#d97757' // the row that grows, in the accent color
const FREE = '#808080' // a mid grey reads as empty on dark and light themes alike
const BUFFER = '#808080'
// Used space is the filled square, about half the row high: the nearest to half that a font centers
// (the half block exists only on the top or bottom edge). Free space is the flat rectangle, half the
// square's height: fonts center the two on the same line, where the box-drawing lines sit a little higher.
export const GLYPH = { used: '■', free: '▬', buffer: '▬' } as const
const KEY = 'slim-hud' // the Button's address
// The diff panel's chord (ctrl+x b by default), free at the prompt while that panel is closed.
const ACTION = 'app:cycleDiffBase'

// The usage line copies claude-hud's (fork RichieHakim/claude-hud at 8310a11, src/render/lines/usage.ts
// and colors.ts, usageStackedBar on). Its bar is ▄ cells: the background paints the top half (quota
// used), the glyph the bottom half (time elapsed in the window). Its 256-color indices are given here
// as the xterm palette's own hex, which a truecolor terminal draws the same.
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 60 * 60 * 1000, seven_day: 7 * 24 * 60 * 60 * 1000 }
const STACK = { time: '#0087af', emptyTop: '#444444', emptyBottom: '#303030' } // 31, 238, 236
const MINUTE = 60_000 // the countdown is in whole minutes

// Held by the host, so the line survives a hot reload of this file.
const reading = atom({ plugin: 'slim-hud', key: 'reading' } as const, null as Reading | null)
const isExpanded = atom({ plugin: 'slim-hud', key: 'isExpanded' } as const, false)
const limits = atom({ plugin: 'slim-hud', key: 'limits' } as const, [] as Limit[])
const now = atom({ plugin: 'slim-hud', key: 'now' } as const, 0) // the time the usage line is drawn for
const model = atom({ plugin: 'slim-hud', key: 'model' } as const, null as string | null) // the main loop's model id
const effort = atom({ plugin: 'slim-hud', key: 'effort' } as const, null as string | null)
const startedAt = atom({ plugin: 'slim-hud', key: 'startedAt' } as const, null as number | null)
// The effort setting outlives /clear, which wipes the state; no event carries it until the next request.
let lastEffort: string | null = null
let ageFrom: number | null = null // startedAt, so the timer also lands where the session's age turns a minute
const todos = atom({ plugin: 'slim-hud', key: 'todos' } as const, [] as Todo[])
let tick: Timer | undefined // the countdown's one pending timer; a reload cancels it with the old module

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'ctx', description: 'Show or hide the context legend under the status line' }).catch(() => {}) // a name already taken is refused: start anyway
    await restore($)
    await stamp($).then(t => startTick($, t)).catch(() => {}) // without a clock the line still draws; its countdown holds
    await readModel($)
    // MCP servers keep connecting after start and add their tools then, with no event to say so.
    void (async () => {
      await refresh($).catch(() => {})
      for (const ms of [5_000, 25_000]) {
        await $.clock.sleep(ms)
        await refresh($).catch(() => {})
      }
    })().catch(() => {})
    return r
  })

  // /clear ends the session without a new session.start, and the session's state goes with it.
  // The countdown's timer stops with the session; after /clear it starts again for the new one.
  on('session.end', async ($, e, next) => {
    stopTick()
    const r = await next(e)
    if (e.reason === 'clear') {
      void (async () => {
        await $.clock.sleep(500) // the new session's state is set up after this hook
        await restore($)
        await refresh($)
        await readModel($)
        if (lastEffort) await update($, effort, () => lastEffort)
        startTick($, await stamp($))
      })().catch(() => {})
    }
    return r
  })

  // Re-read whenever the window's contents or size change: a main turn, a compaction, /clear, /model.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await refresh($).catch(() => {}) // a subagent's turn fills its own window, not this one
    if (!e.agentId) await readModel($) // /model may have switched it
    return r
  })

  // The main loop's todo calls keep the todo line; a subagent's list is its own, as claude-hud reads
  // only the main transcript.
  on('tool.call', async ($, e, next) => {
    if (e.agentId || (e.tool !== 'TodoWrite' && e.tool !== 'TaskCreate' && e.tool !== 'TaskUpdate')) return next(e)
    const r = await next(e)
    if (!r.deny && !r.isError) void update($, todos, list => nextTodos(list, e.tool, e as Record<string, unknown>, r.result)).catch(() => {})
    return r
  }).catch(($, e, next) => next(e)) // this hook only watches: if it fails, the call still runs

  // The effort is known only from the requests the main loop sends; a subagent's may differ.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      lastEffort = String(e.effort)
      void update($, effort, () => lastEffort).catch(() => {})
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.changed.includes('context')) void refresh($).catch(() => {})
    if (e.changed.includes('rateLimits')) void setLimits($, e.rateLimits).catch(() => {})
    return r
  })

  // These three pass over a plugin the person installs where an organization manages Claude Code;
  // there the turn and measure hooks above catch up at the next turn.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && 'messages' in r) void refresh($).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    void refresh($).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    const r = await next(e)
    void refresh($).catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  // No text back: the legend appearing is the answer, and a text row would be read into the context.
  on('command.run', { command: 'ctx' }, async $ => {
    await toggle($)
    return {}
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const rest = await next(e) // the engine's hint line stays, and the terminal draws it above this
    const r = await read($, reading)
    const at = await read($, now)
    const usage = usageRuns(await read($, limits), at, e.viewport?.columns)
    const about = modelRuns(await read($, model), await read($, effort), await read($, startedAt), at)
    const doing = todoRuns(await read($, todos))
    if (!r && !usage && !about && !doing) return rest
    const open = await read($, isExpanded)
    const { Box, Text, Button } = $.ui.resolve(e)
    const room = e.viewport ? e.viewport.columns - MARGIN : undefined
    const head = !r ? '' : open ? `${tokens(r.total)} of ${tokens(r.window)} · ${r.percent}%${r.compactsAt ? ` · compacts at ${tokens(r.compactsAt)}` : ''}` : tokens(r.total)
    const width = barWidth(room, head.length + 1)

    return (
      <Box flexDirection="column">
        {rest}
        {r ? (
          <Button key={KEY} label="Context window: show or hide the legend" plain action={ACTION} onPress={() => void toggle($).catch(() => {})}>
            {width > 0 ? cells(r, width).map(c => <Text color={c.color}>{c.text}</Text>) : null}
            <Text>{width > 0 ? ` ${head}` : head}</Text>
          </Button>
        ) : null}
        {r && open
          ? legend(r, room ?? BAR_CELLS * 2).map(line => (
              <Text wrap="truncate-end">
                {line.map((s, i) => (
                  <Text>
                    {i > 0 && <Text>{SPLIT}</Text>}
                    <Text color={s.color}>{s.kind === 'used' ? '■ ' : `${GLYPH[s.kind]} `}</Text>
                    <Text dimColor={s.kind !== 'used'}>{`${s.name} `}</Text>
                    <Text bold={s.kind === 'used'}>{tokens(s.tokens)}</Text>
                    {s.kind === 'used' && <Text dimColor>{` ${share(s.tokens, r.window)}`}</Text>}
                  </Text>
                ))}
              </Text>
            ))
          : null}
        {[about, usage, doing].map(runs => // the model line sits between the two bars, as a gap
          runs ? (
            <Text wrap="truncate-end">
              {runs.map(u => (
                <Text color={u.color} backgroundColor={u.bg} dimColor={!u.color}>
                  {u.text}
                </Text>
              ))}
            </Text>
          ) : null,
        )}
      </Box>
    )
  })
}

// The expand choice from the store, where it outlives the session's state.
async function restore($: EngineInterface) {
  const open = (await $.store.get('isExpanded').catch(() => undefined)) === true
  await update($, isExpanded, () => open)
}

async function toggle($: EngineInterface): Promise<boolean> {
  const open = await update($, isExpanded, x => !x)
  await $.store.set('isExpanded', open).catch(() => {})
  await refresh($).catch(() => {})
  return open
}

// Asks the engine for /context's breakdown, estimated locally (no token-count calls), and the rate limits.
async function refresh($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  await update($, startedAt, () => usage.startedAt)
  if (usage.startedAt !== ageFrom) {
    ageFrom = usage.startedAt
    if (tick) startTick($, await $.clock.now()) // re-aim a running timer at the age's minutes too
  }
  await setLimits($, usage.rateLimits).catch(() => {}) // the context bar updates whatever the limits do
  const b = usage.context.breakdown
  if (!b || !(b.rawMaxTokens > 0)) return // no window to measure against
  await update($, reading, () => toReading(b))
}

async function setLimits($: EngineInterface, rateLimits: readonly SessionRateLimit[] | undefined) {
  await stamp($)
  await update($, limits, () => (rateLimits ?? []).filter(l => l.kind in WINDOW_MS).map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
}

async function readModel($: EngineInterface) {
  const id = await $.session.model().catch(() => null)
  if (id) await update($, model, () => id)
}

async function stamp($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
  return t
}

// Moves the countdown and the session's age on just after each of their minutes turns: resets fall on
// whole minutes of the clock, the age on whole minutes from the start. The minutes shown are then always
// right, where a timer started at any second would lag up to a minute.
// One timer at a time: a second start replaces the first rather than adding to it.
function startTick($: EngineInterface, at: number) {
  stopTick()
  const schedule = (t: number) => {
    const toClock = MINUTE - (t % MINUTE)
    const toAge = ageFrom === null ? MINUTE : MINUTE - ((((t - ageFrom) % MINUTE) + MINUTE) % MINUTE)
    const timer = $.clock.after(Math.min(toClock, toAge) + 50, () => {
      void stamp($).then(next => tick === timer && schedule(next)).catch(() => {})
    })
    tick = timer
  }
  schedule(at)
}

function stopTick() {
  tick?.cancel()
  tick = undefined
}

// Cells for the bar: BAR_CELLS, or what is left of `room` after the text, or none under MIN_BAR.
export function barWidth(room: number | undefined, text: number): number {
  if (room === undefined) return BAR_CELLS
  const width = Math.min(BAR_CELLS, room - text)
  return width >= MIN_BAR ? width : 0
}

export function toReading(b: {
  categories: { name: string; tokens: number; color: string; kind: string }[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
}): Reading {
  const slices: Slice[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens, color: c.color, kind: c.kind as Slice['kind'] }))
  const order = { used: 0, free: 1, buffer: 2 }
  slices.sort((x, y) => order[x.kind] - order[y.kind]) // stable: used rows keep /context's order
  let next = 0
  for (const s of slices) {
    s.color = s.kind === 'free' ? FREE : s.kind === 'buffer' ? BUFFER : s.name === 'messages' ? MESSAGES : PALETTE[next++ % PALETTE.length]!
  }
  return {
    slices,
    total: b.totalTokens,
    window: b.rawMaxTokens,
    percent: b.percentage,
    compactsAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
  }
}

// The bar as runs of cells: each slice gets its share of `width`, a used one at least one cell.
export function cells(r: Reading, width: number) {
  const sizes = r.slices.map(s => Math.max(s.kind === 'used' ? 1 : 0, Math.round((s.tokens / r.window) * width)))
  // Rounding leaves the sum a few cells off: free space takes the difference first, then the largest slices.
  let diff = width - sizes.reduce((a, n) => a + n, 0)
  const isUsed = (i: number) => r.slices[i]!.kind === 'used'
  const order = r.slices.map((_, i) => i).sort((a, b) => Number(isUsed(a)) - Number(isUsed(b)) || sizes[b]! - sizes[a]!)
  for (const i of order) {
    if (diff === 0) break
    const size = Math.max(isUsed(i) ? 1 : 0, sizes[i]! + diff)
    diff -= size - sizes[i]!
    sizes[i] = size
  }
  return r.slices.map((s, i) => ({ color: s.color, kind: s.kind, text: GLYPH[s.kind].repeat(sizes[i]!) })).filter(c => c.text !== '')
}

// The legend, packed into lines no wider than `width`.
export function legend(r: Reading, width: number) {
  const lines: Slice[][] = [[]]
  let used = 0
  for (const s of r.slices) {
    const size = 2 + s.name.length + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0)
    const line = lines.at(-1)!
    if (line.length > 0 && used + SPLIT.length + size > width) {
      lines.push([s])
      used = size
    } else {
      used += (line.length > 0 ? SPLIT.length : 0) + size
      line.push(s)
    }
  }
  return lines.filter(l => l.length > 0)
}

export function tokens(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(n)
}

export function share(n: number, window: number) {
  const p = (n / window) * 100
  if (p > 0 && p < 0.1) return '<0.1%'
  return `${p >= 10 ? Math.round(p) : +p.toFixed(1)}%`
}

export type Run = { text: string; color?: string; bg?: string } // no color: drawn dim, as the status line draws claude-hud's plain text
// claude-hud's labels are faint as well as dim. A mod can't set faint on a color theme, so they take the
// theme's next grey down, which is about what faint dim text comes to on a dark background.
const LABEL = 'subtle'

// claude-hud's usage line as runs of text, or null when there is nothing true to show: no reading
// of either window yet, or every reading is from before its window reset.
export function usageRuns(rateLimits: readonly Limit[], at: number, columns?: number): Run[] | null {
  const window = (kind: string) => {
    const l = rateLimits.find(x => x.kind === kind)
    if (!l || !Number.isFinite(l.percentUsed)) return null
    const resetAt = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    if (resetAt <= at) return null // the window has reset since this reading, so its percent no longer holds
    return { percent: Math.round(Math.min(100, Math.max(0, l.percentUsed))), resetAt: Number.isFinite(resetAt) ? resetAt : undefined, ms: WINDOW_MS[kind]! }
  }
  const five = window('five_hour')
  const week = window('seven_day')
  if (!five && !week) return null
  const head: Run[] = [{ text: 'Usage', color: LABEL }, { text: ' ' }]

  const full = five?.percent === 100 ? five : week?.percent === 100 ? week : null
  if (full) {
    const reset = resetsIn(full.resetAt, at)
    return [...head, { text: `⚠ Limit reached${reset ? ` (resets in ${reset})` : ''}`, color: 'red' }]
  }

  const size = columns === undefined || columns >= 100 ? 10 : columns >= 60 ? 6 : 4 // claude-hud's widths
  const part = (w: NonNullable<typeof five>): Run[] => {
    const reset = resetsIn(w.resetAt, at)
    const elapsed = w.resetAt === undefined ? null : ((at - (w.resetAt - w.ms)) / w.ms) * 100
    return [
      ...(elapsed === null ? flatBar(w.percent, size) : stackedBar(w.percent, elapsed, size)),
      { text: ' ' },
      { text: `${w.percent}%`, color: percentColor(w.percent) },
      ...(reset ? [{ text: ` (resets in ${reset})` }] : []),
    ]
  }
  const weekly: Run[] = [{ text: 'Weekly', color: LABEL }, { text: ' ' }]
  if (!five) return [...head, ...weekly, ...part(week!)]
  return [...head, ...part(five), ...(week ? [{ text: ' | ' }, ...weekly, ...part(week)] : [])]
}

// Top half: quota used, green to red. Bottom half: time elapsed in the window. Where the color runs
// past the blue, quota is going faster than the window's clock.
export function stackedBar(percent: number, elapsed: number, width: number): Run[] {
  const used = Math.round((percent / 100) * width)
  const passed = Math.round((Math.min(100, Math.max(0, elapsed)) / 100) * width)
  const runs: Run[] = []
  for (let i = 0; i < width; i++) {
    const cell = { text: '▄', color: i < passed ? STACK.time : STACK.emptyBottom, bg: i < used ? stackColor(percent) : STACK.emptyTop }
    const last = runs.at(-1)
    if (last && last.color === cell.color && last.bg === cell.bg) last.text += '▄'
    else runs.push(cell)
  }
  return runs
}

// claude-hud's bar when a window gives no reset time, so the time elapsed is unknown.
function flatBar(percent: number, width: number): Run[] {
  const used = Math.round((percent / 100) * width)
  return [{ text: '█'.repeat(used), color: percentColor(percent) }, { text: '░'.repeat(width - used) }].filter(r => r.text !== '')
}

function stackColor(percent: number) {
  return percent >= 90 ? '#ff0000' : percent >= 70 ? '#ff8700' : percent >= 40 ? '#ffd700' : '#00af00' // 196, 208, 220, 34
}

// claude-hud prints the percent in the terminal's bright blue, bright magenta or red.
function percentColor(percent: number) {
  return percent >= 90 ? 'red' : percent >= 75 ? 'magentaBright' : 'blueBright'
}

// Time to the reset in whole minutes rounded up: 4m, 2h 30m, 3d 2h. Empty once it has passed.
export function resetsIn(resetAt: number | undefined, at: number) {
  if (resetAt === undefined || resetAt <= at) return ''
  const minutes = Math.ceil((resetAt - at) / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
}

const EFFORT_SYMBOL: Record<string, string> = { low: '○', medium: '◔', high: '◑', xhigh: '◕', max: '●' }

// claude-hud's first line: [model, effort] in cyan, then the session's age. Effort is left out until
// the first request reports it, and the age until the clock has a reading; no model, no line.
export function modelRuns(id: string | null, level: string | null, started: number | null, at: number): Run[] | null {
  if (!id) return null
  const symbol = level ? EFFORT_SYMBOL[level] : undefined
  const runs: Run[] = [{ text: `[${modelName(id)}${level ? ` ${symbol ? `${symbol} ` : ''}${level}` : ''}]`, color: 'cyan' }]
  if (started !== null && at >= started) runs.push({ text: ' │ ' }, { text: `⏱️  ${age(at - started)}`, color: LABEL })
  return runs
}

// The engine gives the model's id (claude-opus-5-5); claude-hud shows its name (Opus 5.5). An id of
// another shape is shown as it is.
export function modelName(id: string) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id)
  if (!m) return id
  const family = m[1]!
  return `${family[0]!.toUpperCase()}${family.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

// Whole minutes, rounded down, as claude-hud counts them: <1m, 12m, 2h 5m.
export function age(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}



// The todo list after one of the main loop's todo calls: TodoWrite sends the whole list, TaskCreate adds
// one (its id comes back in the result), TaskUpdate changes or deletes one by id.
export function nextTodos(list: readonly Todo[], tool: string, args: Record<string, unknown>, result: unknown): Todo[] {
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  if (tool === 'TodoWrite') {
    const items = Array.isArray(args.todos) ? args.todos : []
    return items.filter(t => text(t?.content)).map(t => ({ content: t.content, status: todoStatus(t.status) ?? 'pending' }))
  }
  if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: unknown } } | undefined)?.task?.id
    return [...list, { id: id === undefined ? undefined : String(id), content: text(args.subject) ?? text(args.description) ?? 'Untitled task', status: 'pending' }]
  }
  if (tool === 'TaskUpdate') {
    const id = String(args.taskId)
    if (args.status === 'deleted') return list.filter(t => t.id !== id)
    return list.map(t => (t.id === id ? { ...t, content: text(args.subject) ?? t.content, status: todoStatus(args.status) ?? t.status } : t))
  }
  return [...list]
}

function todoStatus(status: unknown): Todo['status'] | undefined {
  if (status === 'pending' || status === 'not_started') return 'pending'
  if (status === 'in_progress' || status === 'running') return 'in_progress'
  if (status === 'completed' || status === 'complete' || status === 'done') return 'completed'
  return undefined
}

// claude-hud's todo line: ▸ the todo in progress (done/total), or ✓ All todos complete (n/n) once every
// one is done; nothing otherwise.
export function todoRuns(list: readonly Todo[]): Run[] | null {
  if (list.length === 0) return null
  const done = list.filter(t => t.status === 'completed').length
  const progress: Run = { text: `(${done}/${list.length})`, color: LABEL }
  const current = list.find(t => t.status === 'in_progress')
  if (current) {
    const content = current.content.length <= 50 ? current.content : `${current.content.slice(0, 47)}...`
    return [{ text: '▸', color: 'yellow' }, { text: ` ${content} ` }, progress]
  }
  return done === list.length ? [{ text: '✓', color: 'green' }, { text: ' All todos complete ' }, progress] : null
}
