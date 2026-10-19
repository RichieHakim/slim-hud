export type Slice = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

export type Reading = {
  slices: Slice[]
  total: number // tokens in use
  window: number // the window measured against
  percent: number
  compactsAt?: number // where auto-compaction runs, when it is on
}

// One todo of the main loop's list; `id` is set for one TaskCreate made.
export type Todo = { id?: string; content: string; status: 'pending' | 'in_progress' | 'completed' }

// One rate-limit window as the engine reports it: five_hour or seven_day.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'slim-hud': {
      reading: Reading | null
      isExpanded: boolean
      limits: Limit[]
      now: number
      model: string | null // the main loop's model id
      effort: string | null
      startedAt: number | null
      todos: Todo[]
    }
  }
}
