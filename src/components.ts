import { defineComponent, f32, u32 } from './ecs'

/** World position. `z` is 2.5D depth today and a real axis for the future 3D plugin. */
export const Position = defineComponent({ x: f32, y: f32, z: f32 })

/** Textured quad drawn at `Position`. `texture` is the id returned by `renderer.loadTexture`. */
export const Sprite = defineComponent({ w: f32, h: f32, texture: u32 })
