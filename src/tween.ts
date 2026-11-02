import type { Game } from './core'
import type { Component, Entity, Values } from './ecs'

/** Easing curve: maps progress 0–1 to eased progress. See `ease`. */
export type Ease = (t: number) => number

/** Easing curves for `tween`: `t` goes from 0 to 1. */
export const ease = {
  linear: (t: number) => t,
  in: (t: number) => t * t,
  out: (t: number) => t * (2 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  /** Overshoots a little and settles: pops, bounces into place. */
  outBack: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
} satisfies Record<string, Ease>

/** Options for `tween`. */
export interface TweenOptions {
  /** Seconds. Default 0.3. */
  duration?: number
  ease?: Ease
  onDone?: () => void
}

/**
 * Animates numeric fields of one entity's component to target values:
 * `tween(game, e, Position, { y: 100 }, { duration: 0.5, ease: ease.out })`. Starts from the current values,
 * stops by itself when done or when the entity loses the component, and returns a function that cancels it.
 * Inside a scene it ends with the scene. Fields are interpolated as plain numbers, so use `mixColor` for `Sprite.tint`.
 */
export function tween<C extends Component>(game: Game, e: Entity, component: C, to: Values<C>, options: TweenOptions = {}) {
  const { duration = 0.3, ease: curve = ease.linear, onDone } = options
  const store = component as unknown as Record<string, Float32Array>
  const target = to as Record<string, number>
  const fields = Object.keys(target)
  const from = fields.map((f) => store[f][e])
  const { world } = game
  const generation = world.generation(e)
  let time = 0
  const stop = game.system((dt) => {
    if (world.generation(e) !== generation || !world.has(e, component)) return stop()
    time = Math.min(duration, time + dt)
    const k = curve(duration > 0 ? time / duration : 1)
    fields.forEach((f, i) => (store[f][e] = from[i] + (target[f] - from[i]) * k))
    if (time < duration) return
    stop()
    onDone?.()
  })
  return stop
}

/** Calls `fn` once after `seconds` of game time. Returns a cancel function; inside a scene it ends with the scene. */
export function after(game: Game, seconds: number, fn: () => void) {
  let time = 0
  const stop = game.system((dt) => {
    if ((time += dt) < seconds) return
    stop()
    fn()
  })
  return stop
}

/** Calls `fn` every `seconds` of game time until cancelled (or the scene ends). */
export function every(game: Game, seconds: number, fn: () => void) {
  let time = 0
  return game.system((dt) => {
    for (time += dt; time >= seconds; time -= seconds) fn()
  })
}

/** Blends two 0xRRGGBB colors, `t` from 0 (a) to 1 (b). For tinting, which `tween` cannot interpolate. */
export const mixColor = (a: number, b: number, t: number) => {
  let out = 0
  for (const shift of [16, 8, 0]) out |= Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift
  return out
}
