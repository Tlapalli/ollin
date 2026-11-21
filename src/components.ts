import type { Game, System } from './core'
import { defineComponent, f32, u32, u8, type Entity, type World } from './ecs'

/** World position. `z` is 2.5D depth today and a real axis for the future 3D plugin. */
export const Position = defineComponent({ x: f32, y: f32, z: f32 })

/** Rotation in radians around the Z axis (2D). Optional: entities without it are drawn unrotated. */
export const Rotation = defineComponent({ angle: f32 })

/**
 * Textured quad centered on `Position`. `texture` is the id returned by `renderer.loadTexture`; without one (texture 0)
 * the sprite is a solid rectangle in its `tint`, for panels, bars and screen fades.
 * `frame` picks a cell when the texture was loaded as a spritesheet or tileset.
 * `tint` multiplies the texture by a 0xRRGGBB color (white = unchanged), `alpha` fades it (0–1),
 * `flipX`/`flipY` (0 or 1) mirror it, e.g. to face a character left.
 */
export const Sprite = defineComponent(
  { w: f32, h: f32, texture: u32, frame: u32, tint: u32, alpha: f32, flipX: u8, flipY: u8 },
  { tint: 0xffffff, alpha: 1 },
)

/**
 * Repeats the sprite's frame to fill the sprite instead of stretching it: scrolling backgrounds, parallax layers,
 * water, floors. Each repetition is `w` x `h` pixels (0, the default, means the frame's own size in the image), and
 * `x`/`y` move the pattern by that many pixels, so `Tiling.x[e] = camera.x * 0.5` scrolls it at half speed.
 * With linear filtering a faint seam can show where the pattern wraps; pixel art (`nearest`) tiles cleanly.
 */
export const Tiling = defineComponent({ w: f32, h: f32, x: f32, y: f32 })

/**
 * Nine-slice scaling for UI panels, buttons and dialog boxes: the borders (in image pixels) keep their size and only
 * the middle stretches, so one small image fits any `Sprite.w`/`h`. `[NineSlice, { left: 8, right: 8, top: 8, bottom: 8 }]`.
 * `scale` draws the borders bigger (2 = each image pixel covers 2x2 sprite pixels), for pixel art UI scaled to the screen.
 */
export const NineSlice = defineComponent({ left: f32, right: f32, top: f32, bottom: f32, scale: f32 }, { scale: 1 })

/**
 * Draws the entity between its last two fixed-tick transforms (by `game.fixedAlpha`), for things that move in `fixed`
 * or `physics` systems: without it they step at 60 Hz and judder on 120 Hz screens. Rapier bodies get it
 * automatically. Don't add it to things moved in `update`; they are already drawn where they are.
 * The renderer keeps the fields; `ready` is 0 until the first fixed tick records a transform. After teleporting an
 * entity, set `Interpolate.ready[e] = 0` so it jumps instead of sliding there.
 */
export const Interpolate = defineComponent({ x: f32, y: f32, angle: f32, ready: u8 })

/**
 * Attaches an entity to a parent (set it with `attach`): every frame, before drawing, its `Position` becomes the
 * parent's drawn position plus (`x`, `y`) turned by the parent's `Rotation`, its `z` the parent's plus `z`, and
 * its `Rotation` (if it has one) the parent's plus `angle`. A weapon in a hand, a health bar over an enemy, a
 * group of UI elements. Chains work. When the parent is despawned, the child is despawned with it.
 */
export const Parent = defineComponent({ entity: u32, generation: u32, x: f32, y: f32, z: f32, angle: f32 })

/** Attaches `child` to `parent` at an offset: `attach(world, sword, hero, { x: 12, y: -4 })`. See `Parent`. */
export function attach(world: World, child: Entity, parent: Entity, offset: { x?: number; y?: number; z?: number; angle?: number } = {}) {
  world.add(child, Parent, { ...offset, entity: parent, generation: world.generation(parent) })
}

/** The system that places `Parent` children; the renderer registers it to run right before drawing. */
export const hierarchy = (game: Game): System => {
  const { world } = game
  const children = world.query(Parent, Position)
  // Frame stamps, so each child is placed once and after its own parent, whatever the query order.
  let placed = new Uint32Array(0)
  let frame = 0
  const place = (e: Entity): boolean => {
    if (e >= placed.length) {
      const next = new Uint32Array(Math.max(e + 1, placed.length * 2))
      next.set(placed)
      placed = next
    }
    if (placed[e] === frame) return world.has(e, Position)
    placed[e] = frame
    const p = Parent.entity[e]
    // The parent is gone when its generation moved on (despawned, maybe recycled), or a parent up the chain is.
    if (world.generation(p) !== Parent.generation[e] || !world.has(p, Position) || (world.has(p, Parent) && !place(p))) {
      world.despawn(e)
      return false
    }
    const at = drawnPosition(game, p)
    const angle = world.has(p, Rotation) ? Rotation.angle[p] : 0
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const ox = Parent.x[e]
    const oy = Parent.y[e]
    Position.x[e] = at.x + ox * c - oy * s
    Position.y[e] = at.y + ox * s + oy * c
    Position.z[e] = Position.z[p] + Parent.z[e]
    if (world.has(e, Rotation)) Rotation.angle[e] = angle + Parent.angle[e]
    return true
  }
  return () => {
    frame++
    const list = children.entities
    // Backwards, because a despawn swaps the last child into the hole.
    for (let i = list.length - 1; i >= 0; i--) {
      place(list[i])
    }
  }
}

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

// ponytail: linear scan, fine for one-vs-many; add a spatial grid for many-vs-many (bullets vs crowds)
/** The first of `others` that overlaps `e` (see `overlaps`), or -1. `hit(player, enemies.entities)` */
export function hit(e: Entity, others: readonly Entity[], inset = 0): Entity {
  for (const o of others) if (o !== e && overlaps(e, o, inset)) return o
  return -1
}
