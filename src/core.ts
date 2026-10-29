import { World } from './ecs'

/** Typed key for a shared resource (renderer, input, physics...). */
export type Token<T> = symbol & { readonly __type?: T }
export const token = <T>(name: string) => Symbol(name) as Token<T>

export type System = (dt: number) => void
export type Plugin = (game: Game) => void | Promise<void>
/** `fixed` runs at a constant rate (physics, deterministic logic), then `update` and `render` once per frame. */
export type Stage = 'fixed' | 'update' | 'render'

export interface GameOptions {
  canvas: HTMLCanvasElement
  plugins?: Plugin[]
  /** Initial entity capacity; the world doubles it when full. */
  capacity?: number
  /** Seconds per `fixed` step. Default 1/60. */
  fixedDt?: number
}

export interface Game {
  readonly canvas: HTMLCanvasElement
  readonly world: World
  readonly fixedDt: number
  set<T>(key: Token<T>, value: T): void
  get<T>(key: Token<T>): T
  system(fn: System, stage?: Stage): void
  /** Advances one frame manually; useful in tests and environments without requestAnimationFrame. */
  step(dt: number): void
  start(): void
  stop(): void
}

// Caps catch-up after a stall (tab in background, breakpoint) to a few fixed steps instead of a spiral of death.
// ponytail: no render interpolation between fixed steps; add it if motion judders on high-refresh displays
const MAX_DT = 0.1

export async function createGame({ canvas, plugins = [], capacity, fixedDt = 1 / 60 }: GameOptions): Promise<Game> {
  const resources = new Map<symbol, unknown>()
  const stages: Record<Stage, System[]> = { fixed: [], update: [], render: [] }
  let accumulator = 0
  let frame = 0
  let last = 0

  const game: Game = {
    canvas,
    world: new World(capacity),
    fixedDt,
    set: (key, value) => void resources.set(key, value),
    get(key) {
      if (!resources.has(key)) throw new Error(`Resource not registered: ${key.description}`)
      return resources.get(key) as never
    },
    system: (fn, stage = 'update') => void stages[stage].push(fn),
    step(dt) {
      accumulator += dt
      while (accumulator >= fixedDt) {
        for (const fn of stages.fixed) fn(fixedDt)
        accumulator -= fixedDt
      }
      for (const fn of stages.update) fn(dt)
      for (const fn of stages.render) fn(dt)
    },
    start() {
      const tick = (t: number) => {
        game.step(last ? Math.min((t - last) / 1000, MAX_DT) : 0)
        last = t
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    },
    stop() {
      cancelAnimationFrame(frame)
      last = 0
    },
  }

  for (const plugin of plugins) await plugin(game)
  return game
}
