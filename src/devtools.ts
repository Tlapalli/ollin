import { Camera } from './camera'
import { Animation, Position, Rotation, Sprite } from './components'
import type { Plugin } from './core'
import type { Component, Entity, World } from './ecs'
import { Renderer } from './render'

export interface DevtoolsOptions {
  /** `KeyboardEvent.code` that shows and hides the panel. Default `Backquote` (the key left of 1). */
  key?: string
  /** Your components, by name, for the inspector: `{ Velocity, Health }`. Built-in components are always listed. */
  components?: Record<string, Component>
  /** Start with the panel visible. Default true. */
  open?: boolean
}

// Refreshing the panel a few times per second keeps its own DOM cost out of the numbers it shows.
const REFRESH_MS = 250

/**
 * Development overlay: fps, main-thread ms per frame, entity, sprite and draw call counts. Click a sprite while the
 * panel is open to inspect its components live. Add it after `webgl2()`. It is DOM, not sprites, so it survives
 * scene changes and never shows up in the counts it measures. It also exposes the game as `ollin.game` in the browser
 * console, for poking at entities while it runs.
 */
export const devtools =
  ({ key = 'Backquote', components = {}, open = true }: DevtoolsOptions = {}): Plugin =>
  (game) => {
    const { canvas, world } = game
    const renderer = game.get(Renderer)
    const camera = game.get(Camera)
    Object.assign(globalThis, { ollin: { game } })
    const named = Object.entries({ Position, Rotation, Sprite, Animation, ...components })

    const panel = document.createElement('pre')
    panel.style.cssText =
      'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;z-index:9999;max-width:calc(100vw - 32px);' +
      'font:12px/1.4 ui-monospace,monospace;color:#f3e6c9;background:#1b1b1bcc;border-left:3px solid #1f9e9a;' +
      'pointer-events:none;white-space:pre-wrap'
    panel.hidden = !open
    document.body.append(panel)
    addEventListener('keydown', (e) => {
      if (e.code === key) panel.hidden = !panel.hidden
    })

    let selected = -1
    const sprites = world.query(Position, Sprite)
    canvas.addEventListener('pointerdown', (e) => {
      if (panel.hidden) return
      const r = canvas.getBoundingClientRect()
      const sx = ((e.clientX - r.left) / r.width) * canvas.width
      const sy = ((e.clientY - r.top) / r.height) * canvas.height
      selected = pick(sprites.entities, sx, sy, camera.toWorld(sx, sy), renderer.screen)
    })

    // Main-thread work = time inside game.step, which covers every stage and the WebGL calls.
    let frames = 0
    let work = 0
    let worst = 0
    let since = performance.now()
    const step = game.step
    game.step = (dt) => {
      const t0 = performance.now()
      step(dt)
      const now = performance.now()
      const ms = now - t0
      frames++
      work += ms
      worst = Math.max(worst, ms)
      if (now - since < REFRESH_MS) return
      if (!panel.hidden) {
        const { drawCalls, sprites: drawn } = renderer.stats
        panel.textContent =
          `${renderer.backend}  ${Math.round((frames * 1000) / (now - since))} fps  ${(work / frames).toFixed(2)} ms/frame (max ${worst.toFixed(2)})\n` +
          `${world.count} entities  ${drawn} sprites  ${drawCalls} draw calls\n` +
          inspect(world, named, selected)
      }
      frames = work = worst = 0
      since = now
    }
  }

/** The topmost sprite under a canvas point, or -1. Screen layers are hit in canvas pixels, the rest in world space. */
export function pick(entities: readonly Entity[], sx: number, sy: number, world: { x: number; y: number }, screen: ReadonlySet<number>) {
  const { x, y, z } = Position
  const { w, h } = Sprite
  let best = -1
  // ponytail: axis-aligned boxes, so rotated sprites are hit by their unrotated bounds
  for (const e of entities) {
    const [px, py] = screen.has(z[e]) ? [sx, sy] : [world.x, world.y]
    if (Math.abs(px - x[e]) <= w[e] / 2 && Math.abs(py - y[e]) <= h[e] / 2 && (best < 0 || z[e] >= z[best])) best = e
  }
  return best
}

const inspect = (world: World, named: [string, Component][], e: Entity) => {
  if (e < 0) return 'click a sprite to inspect it'
  const lines = named
    .filter(([, c]) => world.has(e, c))
    .map(([name, c]) => `${name.padEnd(10)}${Object.keys(c).map((f) => `${f} ${format(f, (c as never as Record<string, ArrayLike<number>>)[f][e])}`).join('  ')}`)
  return `entity ${e}\n${lines.length ? lines.join('\n') : '(despawned)'}`
}

const format = (field: string, v: number) => (field === 'tint' ? `#${v.toString(16).padStart(6, '0')}` : +v.toFixed(2))
