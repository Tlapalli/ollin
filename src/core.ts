/** Typed key for a shared resource (renderer, input, physics...). */
export type Token<T> = symbol & { readonly __type?: T }
export const token = <T>(name: string) => Symbol(name) as Token<T>

export type System = (dt: number) => void
export type Plugin = (game: Game) => void | Promise<void>
export type Stage = 'update' | 'render'

export interface GameOptions {
  canvas: HTMLCanvasElement
  plugins?: Plugin[]
}

export interface Game {
  readonly canvas: HTMLCanvasElement
  set<T>(key: Token<T>, value: T): void
  get<T>(key: Token<T>): T
  system(fn: System, stage?: Stage): void
  /** Advances one frame manually; useful in tests and environments without requestAnimationFrame. */
  step(dt: number): void
  start(): void
  stop(): void
}

const MAX_DT = 0.1 // ponytail: capped variable dt; switch to a fixed step when physics (Rapier) lands

export async function createGame({ canvas, plugins = [] }: GameOptions): Promise<Game> {
  const resources = new Map<symbol, unknown>()
  const stages: Record<Stage, System[]> = { update: [], render: [] }
  let frame = 0
  let last = 0

  const game: Game = {
    canvas,
    set: (key, value) => void resources.set(key, value),
    get(key) {
      if (!resources.has(key)) throw new Error(`Resource not registered: ${key.description}`)
      return resources.get(key) as never
    },
    system: (fn, stage = 'update') => void stages[stage].push(fn),
    step(dt) {
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
