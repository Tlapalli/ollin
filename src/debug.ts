import { Camera } from './camera'
import { token, type Plugin } from './core'

/** Shapes to draw over the game this frame, for debugging: hitboxes, paths, rays, labels. */
export interface DebugDraw {
  line(x1: number, y1: number, x2: number, y2: number, color?: number): void
  /** A box centered on (x, y), like a sprite. */
  rect(x: number, y: number, w: number, h: number, color?: number): void
  circle(x: number, y: number, radius: number, color?: number): void
  text(x: number, y: number, text: string, color?: number): void
}

/**
 * Debug drawing from `debug()`: `game.get(Debug).line(x1, y1, x2, y2, 0xff0000)`. Coordinates are world pixels (through
 * the camera); `debug.screen` takes canvas pixels instead. Shapes last one frame, so draw them every frame from an
 * `update` system. Colors are 0xRRGGBB, green by default.
 */
export interface Debug extends DebugDraw {
  readonly screen: DebugDraw
}

/** Resource key for the debug drawing registered by `debug()`. */
export const Debug = token<Debug>('Debug')

type Shape = [kind: 0 | 1 | 2 | 3, screen: boolean, a: number, b: number, c: number, d: number, color: number, text?: string]

/**
 * Plugin for debug drawing (see `Debug`). It draws on a 2D canvas laid over the game's, so it adds no sprites, works
 * with any renderer, and costs nothing on frames with nothing to draw. Add it after the renderer.
 */
// ponytail: Canvas 2D overlay, fine for hundreds of shapes a frame; draw through the renderer if a game needs thousands
export const debug = (): Plugin => (game) => {
  const { canvas } = game
  const camera = game.get(Camera)
  const shapes: Shape[] = []
  const overlay = document.createElement('canvas')
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:9998'
  document.body.append(overlay)
  const ctx = overlay.getContext('2d')!
  let drewLast = false

  const draw = (screen: boolean): DebugDraw => ({
    line: (x1, y1, x2, y2, color = 0x00ff00) => void shapes.push([0, screen, x1, y1, x2, y2, color]),
    rect: (x, y, w, h, color = 0x00ff00) => void shapes.push([1, screen, x, y, w, h, color]),
    circle: (x, y, radius, color = 0x00ff00) => void shapes.push([2, screen, x, y, radius, 0, color]),
    text: (x, y, text, color = 0x00ff00) => void shapes.push([3, screen, x, y, 0, 0, color, text]),
  })
  game.set(Debug, { ...draw(false), screen: draw(true) })

  game.system(() => {
    if (!shapes.length && !drewLast) return
    // Follow the game canvas: same place on the page, same backing size.
    const r = canvas.getBoundingClientRect()
    Object.assign(overlay.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    if (overlay.width !== canvas.width) overlay.width = canvas.width
    if (overlay.height !== canvas.height) overlay.height = canvas.height
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    const pixel = Math.max(1, canvas.width / Math.max(1, r.width)) // one CSS pixel, in canvas pixels
    ctx.lineWidth = pixel
    ctx.font = `${12 * pixel}px ui-monospace, monospace`
    ctx.textBaseline = 'top'
    const sx = (x: number, screen: boolean) => (screen ? x : (x - camera.x) * camera.zoom + camera.width / 2)
    const sy = (y: number, screen: boolean) => (screen ? y : (y - camera.y) * camera.zoom + camera.height / 2)
    for (const [kind, screen, a, b, c, d, color, text] of shapes) {
      const css = `#${color.toString(16).padStart(6, '0')}`
      const k = screen ? 1 : camera.zoom
      ctx.strokeStyle = ctx.fillStyle = css
      ctx.beginPath()
      if (kind === 0) {
        ctx.moveTo(sx(a, screen), sy(b, screen))
        ctx.lineTo(sx(c, screen), sy(d, screen))
      } else if (kind === 1) ctx.rect(sx(a - c / 2, screen), sy(b - d / 2, screen), c * k, d * k)
      else if (kind === 2) ctx.arc(sx(a, screen), sy(b, screen), c * k, 0, Math.PI * 2)
      else ctx.fillText(text!, sx(a, screen), sy(b, screen))
      if (kind !== 3) ctx.stroke()
    }
    drewLast = shapes.length > 0
    shapes.length = 0
  }, 'render')
}
