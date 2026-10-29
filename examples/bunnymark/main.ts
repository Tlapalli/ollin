import { createGame, input, Input, Renderer, webgl2 } from '../../src'
import glyph from './ollin.png'

// Hold the mouse button to add glyphs. Measures how many it sustains at 60 fps.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const game = await createGame({ canvas, plugins: [webgl2(), input()] })
const renderer = game.get(Renderer)
const pointer = game.get(Input).pointer
const sprites = renderer.layer(await renderer.loadTexture(glyph), 100_000)

const SIZE = 32 * devicePixelRatio
const GRAVITY = 1500 * devicePixelRatio
let vx = new Float32Array(sprites.capacity)
let vy = new Float32Array(sprites.capacity)

game.system((dt) => {
  if (pointer.down) {
    for (let n = 0; n < 500; n++) sprites.add(pointer.x, pointer.y, SIZE, SIZE)
    if (vx.length < sprites.capacity) {
      vx = grow(vx, sprites.capacity)
      vy = grow(vy, sprites.capacity)
    }
    for (let i = sprites.count - 500; i < sprites.count; i++) {
      vx[i] = (Math.random() - 0.5) * 1000 * devicePixelRatio
      vy[i] = (Math.random() - 0.5) * 1000 * devicePixelRatio
    }
  }

  const { x, y } = sprites
  const maxX = canvas.width - SIZE
  const maxY = canvas.height - SIZE
  for (let i = 0; i < sprites.count; i++) {
    vy[i] += GRAVITY * dt
    x[i] += vx[i] * dt
    y[i] += vy[i] * dt
    if (x[i] < 0 || x[i] > maxX) { vx[i] *= -1; x[i] = Math.min(Math.max(x[i], 0), maxX) }
    if (y[i] > maxY) { vy[i] *= -0.85; y[i] = maxY }
  }
})

const stats = document.querySelector('#stats')!
let frames = 0
let since = performance.now()
game.system(() => {
  frames++
  const now = performance.now()
  if (now - since < 500) return
  stats.textContent = `${sprites.count} sprites · ${Math.round((frames * 1000) / (now - since))} fps`
  frames = 0
  since = now
}, 'render')

game.start()

function grow(a: Float32Array, size: number) {
  const next = new Float32Array(size)
  next.set(a)
  return next
}
