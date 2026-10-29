import { World } from './ecs'

/** Typed key for a shared resource (renderer, input, physics...). */
export type Token<T> = symbol & { readonly __type?: T }
export const token = <T>(name: string) => Symbol(name) as Token<T>

export type System = (dt: number) => void
export type Plugin = (game: Game) => void | Promise<void>
/**
 * A level, menu or screen. It spawns entities and registers systems; it may return a cleanup function
 * for anything else it set up (DOM listeners, timers). See `game.scene`.
 */
export type Scene = (game: Game) => void | (() => void) | Promise<void | (() => void)>
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
  /** Registers a system; returns a function that removes it (tweens and timers remove themselves when done). */
  system(fn: System, stage?: Stage): () => void
  /**
   * Switches to a scene: removes the systems the previous scene registered, runs its cleanup and despawns every
   * entity, then runs the new scene. Systems and resources from plugins stay. Call it again with the same scene
   * to restart it. For hot reload during development:
   * `import.meta.hot?.accept('./level', (m) => m && game.scene(m.level))`
   */
  scene(scene: Scene): Promise<void>
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
  // Systems registered while a scene is active belong to it and are removed when the scene changes.
  let owned: Set<System> | undefined
  let cleanup: (() => void) | void

  const game: Game = {
    canvas,
    world: new World(capacity),
    fixedDt,
    set: (key, value) => void resources.set(key, value),
    get(key) {
      if (!resources.has(key)) throw new Error(`Resource not registered: ${key.description}`)
      return resources.get(key) as never
    },
    system(fn, stage = 'update') {
      stages[stage].push(fn)
      const scene = owned
      scene?.add(fn)
      return () => {
        stages[stage] = stages[stage].filter((f) => f !== fn)
        scene?.delete(fn)
      }
    },
    // ponytail: a scene whose setup is still awaiting when the next switch starts will register into the new one;
    // add a scene generation check if quick successive switches (double saves under HMR) cause trouble
    async scene(scene) {
      if (owned) {
        const old = owned
        // New arrays rather than splicing, so a stage that is iterating right now finishes safely.
        for (const stage of Object.keys(stages) as Stage[]) stages[stage] = stages[stage].filter((fn) => !old.has(fn))
      }
      cleanup?.()
      game.world.clear()
      owned = new Set()
      cleanup = await scene(game)
    },
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
