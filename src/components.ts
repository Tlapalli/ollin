import type { System } from './core'
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
 * Short-lived sprite that moves at (`vx`, `vy`) px/s, falls with `gravity` px/s², fades out over `life` seconds and
 * then despawns. Spawn bursts of them with `burst`; the renderer advances them.
 */
export const Particle = defineComponent({ vx: f32, vy: f32, gravity: f32, life: f32, age: f32 }, { life: 1 })

/** The system that advances `Particle`; the renderer registers it. */
export const particles = (world: World): System => {
  const live = world.query(Particle, Position, Sprite)
  return (dt) => {
    const { vx, vy, gravity, life, age } = Particle
    const { x, y } = Position
    const { alpha } = Sprite
    // Backwards, because despawning swaps the last entity into this slot.
    for (let i = live.entities.length - 1; i >= 0; i--) {
      const e = live.entities[i]
      age[e] += dt
      if (age[e] >= life[e]) {
        world.despawn(e)
        continue
      }
      vy[e] += gravity[e] * dt
      x[e] += vx[e] * dt
      y[e] += vy[e] * dt
      alpha[e] = 1 - age[e] / life[e]
    }
  }
}

export interface BurstOptions {
  x: number
  y: number
  z?: number
  texture: number
  frame?: number
  /** Sprite size in pixels. Default 8. */
  size?: number
  tint?: number
  /** How many particles. Default 16. */
  count?: number
  /** Top speed in px/s; each particle gets 50–100% of it. Default 200. */
  speed?: number
  /** Direction in radians (0 = right, -π/2 = up) and the cone around it. Default: a full circle. */
  angle?: number
  spread?: number
  /** Seconds; each particle lives 70–100% of it. Default 0.6. */
  life?: number
  /** px/s², positive falls. Default 0. */
  gravity?: number
}

/** Spawns a burst of `Particle` sprites: sparks, dust, pickups. */
export function burst(world: World, options: BurstOptions) {
  const { x, y, z = 0, texture, frame = 0, size = 8, tint = 0xffffff, count = 16, speed = 200, angle = 0, spread = Math.PI * 2, life = 0.6, gravity = 0 } = options
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread
    const v = speed * (0.5 + Math.random() * 0.5)
    world.spawn(
      [Position, { x, y, z }],
      [Sprite, { w: size, h: size, texture, frame, tint }],
      [Particle, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity, life: life * (0.7 + Math.random() * 0.3) }],
    )
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
