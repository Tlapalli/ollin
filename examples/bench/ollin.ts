import { createGame, defineComponent, f32, Position, Renderer, Sprite, webgl2, webgpu } from '../../src'
import { COUNT, GRAVITY, HEIGHT, measure, SIZE, SPEED, WIDTH } from './bench'
import glyph from './glyph.png'

const canvas = document.querySelector('canvas')!
canvas.width = WIDTH
canvas.height = HEIGHT

// ?webgpu measures the WebGPU backend instead of WebGL2.
const backend = new URLSearchParams(location.search).has('webgpu') ? webgpu : webgl2
const game = await createGame({ canvas, capacity: COUNT, plugins: [backend()] })
const { world } = game
const renderer = game.get(Renderer)
const texture = await renderer.loadTexture(glyph)
// ?ysort draws every sprite in order of y, to measure the cost of a 2.5D layer.
if (new URLSearchParams(location.search).has('ysort')) renderer.ySort.add(0)
const Velocity = defineComponent({ x: f32, y: f32 })

for (let n = 0; n < COUNT; n++) {
  world.spawn(
    [Position, { x: Math.random() * WIDTH, y: Math.random() * HEIGHT }],
    [Velocity, { x: (Math.random() - 0.5) * SPEED, y: (Math.random() - 0.5) * SPEED }],
    [Sprite, { w: SIZE, h: SIZE, texture }],
  )
}

const moving = world.query(Position, Velocity)
game.system((dt) => {
  const { x, y } = Position
  const v = Velocity
  const min = SIZE / 2
  const maxX = WIDTH - min
  const maxY = HEIGHT - min
  for (const e of moving.entities) {
    v.y[e] += GRAVITY * dt
    x[e] += v.x[e] * dt
    y[e] += v.y[e] * dt
    if (x[e] < min || x[e] > maxX) {
      v.x[e] *= -1
      x[e] = Math.min(Math.max(x[e], min), maxX)
    }
    if (y[e] > maxY) {
      v.y[e] *= -0.85
      y[e] = maxY
    }
  }
})

game.start()
measure()
