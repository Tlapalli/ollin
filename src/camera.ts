import { token } from './core'
import { ortho, type Mat4 } from './math'

/**
 * 2D camera: `x`/`y` is the world point at the center of the screen, `zoom` scales world pixels.
 * The default view (centered on the canvas, zoom 1) maps world coordinates 1:1 to canvas pixels.
 * ponytail: no camera rotation; add it to viewProj and toWorld when a game needs it
 */
export interface Camera {
  x: number
  y: number
  zoom: number
  /** Viewport size in canvas pixels; the renderer keeps it in sync with the canvas. */
  width: number
  height: number
  /** Converts canvas pixels (e.g. `Input.pointer`) to world coordinates. */
  toWorld(sx: number, sy: number): { x: number; y: number }
  viewProj(out: Mat4): Mat4
}

export const Camera = token<Camera>('Camera')

export function createCamera(width: number, height: number): Camera {
  return {
    x: width / 2,
    y: height / 2,
    zoom: 1,
    width,
    height,
    toWorld(sx, sy) {
      return { x: this.x + (sx - this.width / 2) / this.zoom, y: this.y + (sy - this.height / 2) / this.zoom }
    },
    viewProj(out) {
      const hw = this.width / 2 / this.zoom
      const hh = this.height / 2 / this.zoom
      return ortho(out, this.x - hw, this.x + hw, this.y + hh, this.y - hh, -1000, 1000)
    },
  }
}
