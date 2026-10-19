import { describe, expect, mock, test } from 'claude-code/testing'

import { age, barWidth, cells, legend, modelName, modelRuns, nextTodos, resetsIn, share, todoRuns, toReading, tokens, usageRuns } from '../hooks/register'
import type { Run } from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const VIEW = { columns: 120, rows: 40, isFullscreen: true }

// /context's breakdown as the engine hands it over, for a 1M window.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 2_800, color: 'promptBorder', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 30_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP tools', tokens: 1_100, color: 'cyan_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'MCP tools (deferred)', tokens: 16_000, color: 'inactive', kind: 'deferred', isDeferred: true },
    { name: 'Memory files', tokens: 67, color: 'claude', kind: 'used', isDeferred: false },
    { name: 'Skills', tokens: 6_000, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Messages', tokens: 144_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'Compact buffer', tokens: 3_000, color: 'inactive', kind: 'buffer', isDeferred: false },
    { name: 'Free space', tokens: 813_033, color: 'promptBorder', kind: 'free', isDeferred: false },
  ],
  totalTokens: 184_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 18,
  autoCompactThreshold: 950_000,
  isAutoCompactEnabled: false,
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  model: 'opus',
  apiUsage: null,
  autocompactSource: 'model-default',
}

const NOW = Date.parse('2026-10-19T01:20:00.000Z')
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString()
// What a live Enterprise session reported (2026-10-19): a 5-hour window only, resetsAt in ISO 8601.
const FIVE_HOUR_ONLY = [{ kind: 'five_hour', percentUsed: 25, resetsAt: at(12_000) }]

// Stands for the engine beneath the mod: the hint line it draws, its store, its usage op, its clock.
function engine(on: any, store: Record<string, unknown> = {}, breakdown: unknown = BREAKDOWN, limits: { rateLimits: unknown[]; startedAt?: number } = { rateLimits: [] }, modelId?: string) {
  const clock = mock.clock(on, { now: NOW })
  if (modelId) on('session.model', () => ({ value: modelId }))
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, text: '', answer: '', toolUses: [] } as any
  })
  const asked: unknown[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('session.usage', (_$: any, e: any) => {
    asked.push(e)
    return { value: { startedAt: limits.startedAt ?? NOW - 5 * 60_000, context: { tokens: 184_000, window: 1_000_000, percent: 18, breakdown }, rateLimits: limits.rateLimits, cost: { usd: 0 } } }
  })
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: e.props.hint }))
  return { asked, store, clock }
}

// claude-hud's usage line for the same figures (the fork's dist at 8310a11, the user's config), turned into
// runs by ansi_to_runs.py: 256-color indices as xterm hex, \e[94m/95m/31m as color names, faint labels as 'subtle',
// plain text uncolored.
// Inputs: [5h percent, seconds to its reset, 7d percent, seconds to its reset].
const CLAUDE_HUD_CASES: Record<string, [number, number, number, number]> = {
  low: [8, 16_200, 12, 525_600],
  mid: [45, 7_200, 55, 259_200],
  high: [92, 3_000, 78, 72_000],
  minutes: [60, 240, 20, 590_400],
  fraction: [23.5, 9_000, 7.4, 345_600],
  limit: [100, 1_800, 64, 172_800],
}
const CLAUDE_HUD_LINES: Record<string, Run[]> = {
  'fraction-120': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄", "color": "#0087af", "bg": "#00af00"}, {"text": "▄▄▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "24%", "color": "blueBright"}, {"text": " (resets in 2h 30m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#0087af", "bg": "#00af00"}, {"text": "▄▄▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "7%", "color": "blueBright"}, {"text": " (resets in 4d)"}],
  'fraction-80': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#0087af", "bg": "#00af00"}, {"text": "▄▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "24%", "color": "blueBright"}, {"text": " (resets in 2h 30m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "7%", "color": "blueBright"}, {"text": " (resets in 4d)"}],
  'high-120': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄▄▄▄", "color": "#0087af", "bg": "#ff0000"}, {"text": "▄", "color": "#303030", "bg": "#ff0000"}, {"text": "▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "92%", "color": "red"}, {"text": " (resets in 50m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄▄▄▄", "color": "#0087af", "bg": "#ff8700"}, {"text": "▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "78%", "color": "magentaBright"}, {"text": " (resets in 20h)"}],
  'high-80': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄", "color": "#0087af", "bg": "#ff0000"}, {"text": "▄", "color": "#303030", "bg": "#ff0000"}, {"text": " "}, {"text": "92%", "color": "red"}, {"text": " (resets in 50m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄", "color": "#0087af", "bg": "#ff8700"}, {"text": "▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "78%", "color": "magentaBright"}, {"text": " (resets in 20h)"}],
  'limit-120': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "⚠ Limit reached (resets in 30m)", "color": "red"}],
  'limit-80': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "⚠ Limit reached (resets in 30m)", "color": "red"}],
  'low-120': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#0087af", "bg": "#00af00"}, {"text": "▄▄▄▄▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "8%", "color": "blueBright"}, {"text": " (resets in 4h 30m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#0087af", "bg": "#00af00"}, {"text": "▄▄▄▄▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "12%", "color": "blueBright"}, {"text": " (resets in 6d 2h)"}],
  'low-80': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "8%", "color": "blueBright"}, {"text": " (resets in 4h 30m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#0087af", "bg": "#00af00"}, {"text": "▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "12%", "color": "blueBright"}, {"text": " (resets in 6d 2h)"}],
  'mid-120': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄", "color": "#0087af", "bg": "#ffd700"}, {"text": "▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "45%", "color": "blueBright"}, {"text": " (resets in 2h) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄▄", "color": "#0087af", "bg": "#ffd700"}, {"text": "▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "55%", "color": "blueBright"}, {"text": " (resets in 3d)"}],
  'mid-80': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄", "color": "#0087af", "bg": "#ffd700"}, {"text": "▄", "color": "#0087af", "bg": "#444444"}, {"text": "▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "45%", "color": "blueBright"}, {"text": " (resets in 2h) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄", "color": "#0087af", "bg": "#ffd700"}, {"text": "▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "55%", "color": "blueBright"}, {"text": " (resets in 3d)"}],
  'minutes-120': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄▄▄", "color": "#0087af", "bg": "#ffd700"}, {"text": "▄▄▄▄", "color": "#0087af", "bg": "#444444"}, {"text": " "}, {"text": "60%", "color": "blueBright"}, {"text": " (resets in 4m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄▄", "color": "#303030", "bg": "#00af00"}, {"text": "▄▄▄▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "20%", "color": "blueBright"}, {"text": " (resets in 6d 20h)"}],
  'minutes-80': [{"text": "Usage", "color": "subtle"}, {"text": " "}, {"text": "▄▄▄▄", "color": "#0087af", "bg": "#ffd700"}, {"text": "▄▄", "color": "#0087af", "bg": "#444444"}, {"text": " "}, {"text": "60%", "color": "blueBright"}, {"text": " (resets in 4m) | "}, {"text": "Weekly", "color": "subtle"}, {"text": " "}, {"text": "▄", "color": "#303030", "bg": "#00af00"}, {"text": "▄▄▄▄▄", "color": "#303030", "bg": "#444444"}, {"text": " "}, {"text": "20%", "color": "blueBright"}, {"text": " (resets in 6d 20h)"}],
}

// Adjacent runs in the same colors read as one, however each side splits its text.
const merged = (runs: readonly Run[] | null) =>
  (runs ?? []).reduce<Run[]>((out, r) => {
    const last = out.at(-1)
    if (last && last.color === r.color && last.bg === r.bg) last.text += r.text
    else out.push({ ...r })
    return out
  }, []).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)))
const plain = (runs: readonly Run[] | null) => (runs ?? []).map(r => r.text).join('')

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the first refresh runs in the background
const start = async ($: any) => {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await settle()
}
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('|')

describe('slim-hud', () => {
  test('helpers', () => {
    expect(tokens(2_800)).toBe('2.8k')
    expect(tokens(184_000)).toBe('184k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(share(67, 1_000_000)).toBe('<0.1%')

    const r = toReading(BREAKDOWN)
    expect(r.slices.map(s => s.name)).toEqual(['system prompt', 'system tools', 'mcp tools', 'memory files', 'skills', 'messages', 'free space', 'compact buffer'])
    expect(r.compactsAt).toBeUndefined() // auto-compaction is off in this breakdown
    expect(r.slices.find(s => s.name === 'messages')?.color).toBe('#d97757')
    for (const width of [8, 20, 40]) {
      const bar = cells(r, width)
      expect(bar.reduce((n, c) => n + [...c.text].length, 0)).toBe(width)
      expect(bar.filter(c => c.kind === 'used').every(c => [...c.text].length >= 1)).toBe(true) // the 67-token row still shows
    }
    expect(cells(r, 40).find(c => c.kind === 'used')?.text).toMatch(/^■+$/)
    expect(cells(r, 40).find(c => c.kind === 'free')?.text).toMatch(/^▬+$/)

    expect(barWidth(undefined, 5)).toBe(40) // not yet measured
    expect(barWidth(118, 5)).toBe(40)
    expect(barWidth(30, 5)).toBe(25) // narrow: the bar gives way to the text
    expect(barWidth(10, 5)).toBe(0) // too narrow for a bar: the count alone
    for (const line of legend(r, 60)) {
      const size = line.reduce((n, s, i) => n + (i ? 2 : 0) + 2 + s.name.length + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0), 0)
      expect(size <= 60 || line.length === 1).toBe(true)
    }
  })

  test('one line under the hint: the bar and the tokens in use', async ($, on) => {
    const { asked } = engine(on)
    await start($)
    expect(asked).toEqual([{ breakdown: 'summary' }]) // estimated locally, never the token-count API
    for (const surface of SURFACES) {
      for (const viewport of [VIEW, undefined]) {
        const hint = await $.ui.mount({ plugin: 'slim-hud', surface, ...HINT, viewport } as any)
        const shown = await texts(hint)
        expect(shown).toMatch(/^\? for shortcuts\|/) // the engine's hint is kept, first
        expect(shown).toMatch(/■/)
        expect(shown).toMatch(/\| 184k$/)
        expect(shown).not.toMatch(/system tools|of 1M/) // no legend by default
        await hint.unmount()
      }
    }
  })

  test('draws nothing of its own before the first reading', async ($, on) => {
    engine(on, {}, null) // no breakdown yet
    await start($)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    expect(await texts(hint)).toBe('? for shortcuts')
    await hint.unmount()
  })

  test('/ctx shows the legend, again hides it, and the choice is stored', async ($, on) => {
    const { store } = engine(on)
    await start($)
    expect((await $.command.run({ command: 'ctx', args: '' } as any)).text).toBeUndefined() // no row for the model to read
    expect(store.isExpanded).toBe(true)
    for (const surface of SURFACES) {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface, ...HINT, viewport: VIEW } as any)
      const shown = await texts(hint)
      expect(shown).toMatch(/184k of 1M · 18%/)
      expect(shown).toMatch(/system tools /)
      expect(shown).toMatch(/memory files .*67.*<0\.1%/)
      expect(shown).toMatch(/free space .*813k/)
      await hint.unmount()
    }
    await $.command.run({ command: 'ctx', args: '' } as any)
    expect(store.isExpanded).toBe(false)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    expect(await texts(hint)).not.toMatch(/system tools/)
    await hint.unmount()
  })

  test('pressing the line (a click or its chord) toggles the legend', async ($, on) => {
    const { store } = engine(on)
    await start($)
    for (const surface of SURFACES) {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface, ...HINT, viewport: VIEW } as any)
      await hint.press({ key: 'slim-hud' })
      expect(store.isExpanded).toBe(true)
      expect(await texts(hint)).toMatch(/system tools /)
      await hint.press({ key: 'slim-hud' })
      expect(store.isExpanded).toBe(false)
      expect(await texts(hint)).not.toMatch(/system tools/)
      await hint.unmount()
    }
  })

  test('a session after one that expanded it starts expanded', async ($, on) => {
    engine(on, { isExpanded: true })
    await start($)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    expect(await texts(hint)).toMatch(/system tools /)
    await hint.unmount()
  })

  test('refreshes after a main turn and a context measurement, not after a subagent turn', async ($, on) => {
    const { asked } = engine(on)
    await start($)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, agentId: 'a1' } as any)
    expect(asked.length).toBe(1)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(asked.length).toBe(2)
    await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [], changed: ['rateLimits'] } as any)
    await settle()
    expect(asked.length).toBe(2)
    await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [], changed: ['context'] } as any)
    await settle()
    expect(asked.length).toBe(3)
  })

  test('reads again 5 s and 30 s after start, for MCP tools that load late', async ($, on) => {
    const { asked, clock } = engine(on)
    await start($)
    expect(asked.length).toBe(1)
    await clock.advance(5_000)
    await settle()
    expect(asked.length).toBe(2)
    await clock.advance(25_000)
    await settle()
    expect(asked.length).toBe(3)
    await clock.advance(60_000)
    await settle()
    expect(asked.length).toBe(3) // and then only on change
  })

  test('after /clear wipes the session state, reads again and keeps the expand choice', async ($, on) => {
    const { asked, clock } = engine(on, { isExpanded: true })
    await start($)
    const before = asked.length
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as any)
    await clock.advance(500)
    await settle()
    expect(asked.length).toBe(before + 1)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    expect(await texts(hint)).toMatch(/system tools /)
    await hint.unmount()
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } } as any)
    await clock.advance(500)
    await settle()
    expect(asked.length).toBe(before + 1) // leaving reads nothing
  })

  test('usage: the same text and colors as claude-hud, cell for cell', () => {
    for (const [name, [p5, s5, p7, s7]] of Object.entries(CLAUDE_HUD_CASES)) {
      const limits = [
        { kind: 'five_hour', percentUsed: p5, resetsAt: at(s5) },
        { kind: 'seven_day', percentUsed: p7, resetsAt: at(s7) },
      ]
      for (const columns of [80, 120]) {
        expect({ name, columns, runs: merged(usageRuns(limits, NOW, columns)) }).toEqual({ name, columns, runs: CLAUDE_HUD_LINES[`${name}-${columns}`] })
      }
      expect(plain(usageRuns(limits, NOW, 200))).toBe(plain(usageRuns(limits, NOW, 120))) // 10 cells from 100 columns up
    }
    expect(plain(usageRuns(FIVE_HOUR_ONLY, NOW, 120))).toBe('Usage ▄▄▄▄▄▄▄▄▄▄ 25% (resets in 3h 20m)')
    expect(plain(usageRuns(FIVE_HOUR_ONLY, NOW, 50))).toBe('Usage ▄▄▄▄ 25% (resets in 3h 20m)') // 4 cells under 60 columns
    expect(plain(usageRuns([{ kind: 'seven_day', percentUsed: 30, resetsAt: at(266_400) }], NOW, 120))).toBe('Usage Weekly ▄▄▄▄▄▄▄▄▄▄ 30% (resets in 3d 2h)')
    expect(merged(usageRuns([{ kind: 'five_hour', percentUsed: 40 }], NOW, 120))).toEqual([
      { text: 'Usage', color: 'subtle' },
      { text: ' ' },
      { text: '████', color: 'blueBright' },
      { text: '░░░░░░ ' },
      { text: '40%', color: 'blueBright' },
    ]) // no reset time: claude-hud's flat bar, no countdown

    expect([240, 3_600, 9_000, 259_200, 266_400, 30].map(s => resetsIn(NOW + s * 1000, NOW))).toEqual(['4m', '1h', '2h 30m', '3d', '3d 2h', '1m'])
    expect(resetsIn(NOW, NOW)).toBe('')
  })

  test('usage: nothing drawn without a true reading', () => {
    const none = [
      [], // before the first reading, or off a subscription
      [{ kind: 'spend_limit', percentUsed: 12, resetsAt: at(600) }], // a gateway's window: not one claude-hud draws
      [{ kind: 'five_hour', percentUsed: 92, resetsAt: at(-60) }], // read before its window reset: 92% no longer holds
      [{ kind: 'five_hour', percentUsed: Number.NaN, resetsAt: at(600) }],
    ]
    for (const limits of none) expect(usageRuns(limits, NOW, 120)).toBeNull()
    const oneStale = [
      { kind: 'five_hour', percentUsed: 92, resetsAt: at(-60) },
      { kind: 'seven_day', percentUsed: 30, resetsAt: at(266_400) },
    ]
    expect(plain(usageRuns(oneStale, NOW, 120))).toBe('Usage Weekly ▄▄▄▄▄▄▄▄▄▄ 30% (resets in 3d 2h)')
  })

  test('usage: a row under the context bar, or alone, or not at all', async ($, on) => {
    const limits = { rateLimits: [] as unknown[] }
    const { asked } = engine(on, {}, BREAKDOWN, limits)
    await start($)
    for (const surface of SURFACES) {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface, ...HINT, viewport: VIEW } as any)
      expect(await texts(hint)).not.toMatch(/Usage/) // no reading yet: no row, no placeholder
      await hint.unmount()
    }
    // A measurement carries the windows: the row appears with no extra read.
    limits.rateLimits = FIVE_HOUR_ONLY
    await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: FIVE_HOUR_ONLY, changed: ['rateLimits'] } as any)
    await settle()
    expect(asked.length).toBe(1)
    for (const surface of SURFACES) {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface, ...HINT, viewport: VIEW } as any)
      expect(await texts(hint)).toMatch(/^\? for shortcuts\|.*■.*\| 184k\|Usage ▄{10} 25% \(resets in 3h 20m\)\|/u)
      await hint.unmount()
    }
    await $.command.run({ command: 'ctx', args: '' } as any) // the legend opens between the bar and the usage row
    const open = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    expect(await texts(open)).toMatch(/184k of 1M.*system tools.*Usage.*25%/)
    await open.unmount()
    await $.command.run({ command: 'ctx', args: '' } as any)
  })

  test('usage: no rateLimits field at all leaves the context bar drawing, with no usage row', async ($, on) => {
    engine(on, {}, BREAKDOWN, { rateLimits: undefined as any })
    await start($)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    const shown = await texts(hint)
    expect(shown).toMatch(/\| 184k$/)
    expect(shown).not.toMatch(/Usage/)
    await hint.unmount()
  })

  test('usage: drawn even before the context reading', async ($, on) => {
    engine(on, {}, null, { rateLimits: FIVE_HOUR_ONLY })
    await start($)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    expect(await texts(hint)).toMatch(/^\? for shortcuts\|Usage ▄{10} 25% \(resets in 3h 20m\)\|/) // no context bar, no gap
    await hint.unmount()
  })

  test('usage: the countdown moves as each minute turns; one timer per session, stopped when it ends', async ($, on) => {
    let ticks = 0
    on('state.set', { key: 'now' }, ($: any, e: any, next: any) => (ticks++, next(e))) // one write of the time per running timer per minute
    const { clock } = engine(on, {}, BREAKDOWN, { rateLimits: FIVE_HOUR_ONLY })
    const countdown = async () => {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
      const shown = (await texts(hint)).match(/resets in ([^)]*)/)?.[1]
      await hint.unmount()
      return shown
    }
    await clock.advance(30_000) // start half a minute in: the reset is 3h 19m 30s away
    await start($)
    expect(await countdown()).toBe('3h 20m')
    await clock.advance(30_100) // the minute turns: 3h 19m left
    expect(await countdown()).toBe('3h 19m')
    await clock.advance(59_900)
    expect(await countdown()).toBe('3h 19m') // 3h 18m 00.1s, rounded up
    await clock.advance(200)
    expect(await countdown()).toBe('3h 18m')

    await start($) // a reload fires session.start again: still one timer
    await clock.advance(30_000)
    ticks = 0
    await clock.advance(120_000)
    expect(ticks).toBe(2)
    expect(await countdown()).toBe('3h 16m')

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } } as any)
    ticks = 0
    await clock.advance(180_000)
    expect(ticks).toBe(0) // stopped with the session
    expect(await countdown()).toBe('3h 16m')

    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as any)
    await clock.advance(500)
    await settle()
    ticks = 0
    await clock.advance(60_000)
    expect(ticks).toBe(1) // /clear keeps the session going, so its timer starts again
    expect(await countdown()).toBe('3h 12m')
  })

  test('model line: the same text as claude-hud', () => {
    expect(['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-5-20250929', 'claude-opus-4-1[1m]', 'claude-fable-6', 'some-gateway-model'].map(modelName)).toEqual([
      'Opus 5.5', 'Haiku 5.5', 'Sonnet 4.5', 'Opus 4.1', 'Fable 6', 'some-gateway-model',
    ])
    expect([30_000, 60_000, 59 * 60_000, 120 * 60_000, 125 * 60_000 + 59_000].map(age)).toEqual(['<1m', '1m', '59m', '2h 0m', '2h 5m'])
    // claude-hud on a live session: \e[36m[Opus 5.5 ◕ xhigh] then " │ " then faint "⏱️  <1m"
    expect(modelRuns('claude-opus-5-5', 'xhigh', NOW, NOW + 20_000)).toEqual([
      { text: '[Opus 5.5 ◕ xhigh]', color: 'cyan' },
      { text: ' │ ' },
      { text: '⏱️  <1m', color: 'subtle' },
    ])
    expect(plain(modelRuns('claude-haiku-5-5', 'medium', NOW, NOW + 12 * 60_000))).toBe('[Haiku 5.5 ◔ medium] │ ⏱️  12m')
    expect(plain(modelRuns('claude-opus-5-5', null, NOW, NOW))).toBe('[Opus 5.5] │ ⏱️  <1m') // effort not reported yet
    expect(plain(modelRuns('claude-opus-5-5', '7', NOW, NOW))).toBe('[Opus 5.5 7] │ ⏱️  <1m') // a level with no symbol
    expect(plain(modelRuns('claude-opus-5-5', 'max', null, NOW))).toBe('[Opus 5.5 ● max]') // no start time: no age
    expect(modelRuns(null, 'max', NOW, NOW)).toBeNull()
  })

  test('model line: between the two bars; effort from the main loop only, kept across /clear', async ($, on) => {
    const { clock } = engine(on, {}, BREAKDOWN, { rateLimits: FIVE_HOUR_ONLY }, 'claude-opus-5-5')
    const lastRow = async () => {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
      const shown = await texts(hint)
      await hint.unmount()
      return shown
    }
    const step = async (fields: object) => {
      const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...fields } as any)
      for await (const _ of stream); // a stream runs as it is read
    }
    await start($)
    expect(await lastRow()).toMatch(/\| 184k\|\[Opus 5\.5\] │ ⏱️  5m\|.*\|Usage /) // bar, the model line, then usage
    await step({ effort: 'xhigh' })
    await settle()
    expect(await lastRow()).toMatch(/\[Opus 5\.5 ◕ xhigh\] │ ⏱️  5m/)
    await step({ effort: 'low', agentId: 'a1' }) // a subagent's request
    await settle()
    expect(await lastRow()).toMatch(/\[Opus 5\.5 ◕ xhigh\]/)
    await clock.advance(60_100)
    expect(await lastRow()).toMatch(/⏱️  6m/)
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as any)
    await clock.advance(500)
    await settle()
    expect(await lastRow()).toMatch(/\[Opus 5\.5 ◕ xhigh\]/)
  })

  test('model line: the age turns over on the minute the session started, not the clock minute', async ($, on) => {
    const { clock } = engine(on, {}, BREAKDOWN, { rateLimits: [], startedAt: NOW - 20_000 }, 'claude-opus-5-5')
    const ageShown = async () => {
      const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
      const shown = (await texts(hint)).match(/⏱️  ([^|]*)$/)?.[1]
      await hint.unmount()
      return shown
    }
    await start($)
    expect(await ageShown()).toBe('<1m') // started 20 s ago
    await clock.advance(40_100) // 1 min after the start, 20 s before the clock's minute
    expect(await ageShown()).toBe('1m')
  })

  test('todos: the same line as claude-hud, from either kind of todo tool', () => {
    const written = nextTodos([], 'TodoWrite', { todos: [
      { content: 'Read the source', status: 'completed', activeForm: 'x' },
      { content: 'Write the usage line and its tests, then try it live in tmux sessions', status: 'in_progress', activeForm: 'x' },
      { content: 'Report', status: 'pending', activeForm: 'x' },
    ] }, undefined)
    expect(todoRuns(written)).toEqual([{ text: '▸', color: 'yellow' }, { text: ' Write the usage line and its tests, then try it... ' }, { text: '(1/3)', color: 'subtle' }])
    let tasks = nextTodos([], 'TaskCreate', { subject: 'First', description: 'd' }, { task: { id: '1', subject: 'First' } })
    tasks = nextTodos(tasks, 'TaskCreate', { subject: 'Second', description: 'd' }, { task: { id: '2', subject: 'Second' } })
    expect(todoRuns(tasks)).toBeNull() // none in progress, not all done
    tasks = nextTodos(tasks, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, undefined)
    expect(plain(todoRuns(tasks))).toBe('▸ First (0/2)')
    tasks = nextTodos(tasks, 'TaskUpdate', { taskId: '1', status: 'completed' }, undefined)
    tasks = nextTodos(tasks, 'TaskUpdate', { taskId: '2', status: 'deleted' }, undefined)
    expect(plain(todoRuns(tasks))).toBe('✓ All todos complete (1/1)')
    expect(todoRuns([])).toBeNull()
  })

  test('todos: a main-loop TodoWrite call sets the line', async ($, on) => {
    engine(on)
    on('tool.call', () => ({ result: {} }) as any)
    await start($)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'One', status: 'in_progress', activeForm: 'x' }, { content: 'Two', status: 'pending', activeForm: 'x' }] } as any)
    const hint = await $.ui.mount({ plugin: 'slim-hud', surface: 'terminal', ...HINT, viewport: VIEW } as any)
    const rows = (await hint.findAll({ type: 'Text' })).map((t: any) => t.text as string)
    expect(rows).toContain('▸ One (0/2)')
    await hint.unmount()
  })
})
