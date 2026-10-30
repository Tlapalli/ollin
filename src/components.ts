import type { Game, System } from './core'
import { defineComponent, f32, u32, u8, type Entity, type World } from './ecs'

/** World position. `z` is 2.5D depth today and a real axis for the future 3D plugin. */
export const Position = defineComponent({ x: f32, y: f32, z: f32 })

/** Rotation in radians around the Z axis (2D). Optional: entities without it are drawn unrotated. */
export const Rotation = defineComponent({ angle: f32 })

/**
 * Textured quad centered on `Position`. `texture` is the id returned by `renderer.loadTexture`;
 * `frame` picks a cell when the texture was loaded as a spritesheet or tileset.
 * `tint` multiplies the texture by a 0xRRGGBB color (white = unchanged), `alpha` fades it (0–1),
 * `flipX`/`flipY` (0 or 1) mirror it, e.g. to face a character left.
 */
export const Sprite = defineComponent(
  { w: f32, h: f32, texture: u32, frame: u32, tint: u32, alpha: f32, flipX: u8, flipY: u8 },
  { tint: 0xffffff, alpha: 1 },
)

/**
 * Draws the entity between its last two fixed-tick transforms (by `game.fixedAlpha`), for things that move in `fixed`
 * or `physics` systems: without it they step at 60 Hz and judder on 120 Hz screens. Rapier bodies get it
 * automatically. Don't add it to things moved in `update`; they are already drawn where they are.
 * The renderer keeps the fields; `ready` is 0 until the first fixed tick records a transform. After teleporting an
 * entity, set `Interpolate.ready[e] = 0` so it jumps instead of sliding there.
 */
export const Interpolate = defineComponent({ x: f32, y: f32, angle: f32, ready: u8 })

/**
 * Where the renderer draws an entity this frame: `Position`, or between its last two fixed-tick positions for
 * `Interpolate` entities. Follow this with the camera, or a smoothly drawn player looks like it shakes.
 */
export function drawnPosition(game: Game, e: Entity) {
  const { x, y } = Position
  if (!game.world.has(e, Interpolate) || !Interpolate.ready[e]) return { x: x[e], y: y[e] }
  const t = game.fixedAlpha
  return { x: Interpolate.x[e] + (x[e] - Interpolate.x[e]) * t, y: Interpolate.y[e] + (y[e] - Interpolate.y[e]) * t }
}

/**
 * Plays `count` spritesheet frames from `start` at `fps`, writing `Sprite.frame`. Loops unless `once` is 1,
 * in which case it holds the last frame. `time` is seconds since it started; set it to 0 to restart.
 */
export const Animation = defineComponent({ start: u32, count: u32, fps: f32, time: f32, once: u8 }, { count: 1, fps: 10 })

/** The system that advances `Animation`; the renderer registers it, so games never add it themselves. */
export const animation = (world: World): System => {
  const playing = world.query(Animation, Sprite)
  return (dt) => {
    const { start, count, fps, time, once } = Animation
    const { frame } = Sprite
    for (const e of playing.entities) {
      time[e] += dt
      const n = Math.max(1, count[e])
      const i = Math.floor(time[e] * fps[e])
      frame[e] = start[e] + (once[e] ? Math.min(i, n - 1) : i % n)
    }
  }
}

/**
 * Whether two sprites' boxes overlap (centered on `Position`, sized by `Sprite`). `inset` shrinks both boxes by that
 * many pixels per side, for forgiving hits. Ignores rotation.
 */
export function overlaps(a: Entity, b: Entity, inset = 0) {
  const { x, y } = Position
  const { w, h } = Sprite
  return Math.abs(x[a] - x[b]) < (w[a] + w[b]) / 2 - 2 * inset && Math.abs(y[a] - y[b]) < (h[a] + h[b]) / 2 - 2 * inset
}

/** The first of `others` that overlaps `e` (see `overlaps`), or -1. `hit(player, enemies.entities)` */
// ponytail: linear scan, fine for one-vs-many; add a spatial grid for many-vs-many (bullets vs crowds)
export function hit(e: Entity, others: readonly Entity[], inset = 0): Entity {
  for (const o of others) if (o !== e && overlaps(e, o, inset)) return o
  return -1
}
