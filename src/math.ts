/** Column-major mat4 in a Float32Array: same layout as WebGL and three.js, no conversions. */
export type Mat4 = Float32Array

/** A new zeroed `Mat4`. */
export const mat4 = (): Mat4 => new Float32Array(16)

/** Orthographic projection. With top < bottom the Y axis grows downward, like screen space. */
export function ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const lr = 1 / (left - right)
  const bt = 1 / (bottom - top)
  const nf = 1 / (near - far)
  out.fill(0)
  out[0] = -2 * lr
  out[5] = -2 * bt
  out[10] = 2 * nf
  out[12] = (left + right) * lr
  out[13] = (top + bottom) * bt
  out[14] = (far + near) * nf
  out[15] = 1
  return out
}
