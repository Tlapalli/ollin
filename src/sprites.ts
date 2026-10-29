const FIELDS = ['x', 'y', 'z', 'w', 'h'] as const
export type SpriteField = (typeof FIELDS)[number]

/**
 * Sprites stored as SoA: one Float32Array per field. This is the layout the ECS (phase 2) will use,
 * uploaded to the GPU or shared with WASM as-is, without copying object by object.
 * `z` is 2.5D depth; for now it only reaches the shader, draw order is the index.
 */
export class Sprites {
  count = 0
  x!: Float32Array
  y!: Float32Array
  z!: Float32Array
  w!: Float32Array
  h!: Float32Array

  constructor(capacity = 1024) {
    for (const f of FIELDS) this[f] = new Float32Array(capacity)
  }

  get capacity() {
    return this.x.length
  }

  add(x: number, y: number, w: number, h: number, z = 0): number {
    if (this.count === this.capacity) this.grow()
    const i = this.count++
    this.x[i] = x
    this.y[i] = y
    this.z[i] = z
    this.w[i] = w
    this.h[i] = h
    return i
  }

  private grow() {
    for (const f of FIELDS) {
      const next = new Float32Array(this.capacity * 2)
      next.set(this[f])
      this[f] = next
    }
  }
}

export const SPRITE_FIELDS = FIELDS
