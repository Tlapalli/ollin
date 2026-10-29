import type { System } from './core'
import { defineComponent, f32, u32, u8, type World } from './ecs'

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
