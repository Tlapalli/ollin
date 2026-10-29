import { defineComponent, f32, u32 } from './ecs'

/** World position. `z` is 2.5D depth today and a real axis for the future 3D plugin. */
export const Position = defineComponent({ x: f32, y: f32, z: f32 })

/** Rotation in radians around the Z axis (2D). Optional: entities without it are drawn unrotated. */
export const Rotation = defineComponent({ angle: f32 })

/**
 * Textured quad centered on `Position`. `texture` is the id returned by `renderer.loadTexture`;
 * `frame` picks a cell when the texture was loaded as a spritesheet or tileset.
 */
export const Sprite = defineComponent({ w: f32, h: f32, texture: u32, frame: u32 })
