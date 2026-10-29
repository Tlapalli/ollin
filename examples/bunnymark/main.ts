import { createGame, defineComponent, devtools, f32, input, Input, Position, Renderer, Sprite, webgl2 } from '../../src'
import glyph from './ollin.png'

// Hold the mouse button to add glyphs. Measures how many it sustains at 60 fps.
const canvas = document.querySelector('canvas')!
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio

const Velocity = defineComponent({ x: f32, y: f32 })

const game = await createGame({ canvas, capacity: 100_000, plugins: [webgl2(), input(), devtools({ components: { Velocity } })] })
const { world } = game
const pointer = game.get(Input).pointer
const texture = await game.get(Renderer).loadTexture(glyph)

const SIZE = 32 * devicePixelRatio
const GRAVITY = 1500 * devicePixelRatio
const SPEED = 1000 * devicePixelRatio

game.system(() => {
  if (!pointer.down) return
  for (let n = 0; n < 500; n++) {
    world.spawn(
      [Position, { x: pointer.x, y: pointer.y }],
      [Velocity, { x: (Math.random() - 0.5) * SPEED, y: (Math.random() - 0.5) * SPEED }],
      [Sprite, { w: SIZE, h: SIZE, texture }],
    )
  }
})

const moving = world.query(Position, Velocity)
game.system((dt) => {
  const { x, y } = Position
  const v = Velocity
  const min = SIZE / 2
  const maxX = canvas.width - min
  const maxY = canvas.height - min
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
