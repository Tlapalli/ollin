import { expect, it } from 'vitest'
import { Interpolate, Position, Sprite } from './components'
import { createGame } from './core'
import { createRenderer, FLOATS_PER_PARTICLE, FLOATS_PER_SPRITE, Renderer, type Backend } from './render'

// The render core is GPU-free: a fake backend records what it is asked to draw.
class FakeImage {
  width = 32
  height = 16
  src = ''
  decode = () => Promise.resolve()
}
globalThis.Image = FakeImage as never

const setup = async () => {
  const sprites: number[] = []
  const writes: [first: number, count: number][] = []
  const particleDraws: number[] = []
  const backend: Backend = {
    name: 'webgl2',
    createTexture: () => ({}),
    begin() {},
    end() {},
    draw: (data, count) => {
      for (let i = 0; i < count; i++) sprites.push(data[i * FLOATS_PER_SPRITE]) // x of each sprite
    },
    createParticles: () => ({}),
    writeParticles: (_pool, first, data) => void writes.push([first, data.length / FLOATS_PER_PARTICLE]),
    drawParticles: (_pool, count) => void particleDraws.push(count),
  }
  const game = await createGame({ canvas: { width: 100, height: 100 } as HTMLCanvasElement, fixedDt: 0.1, plugins: [(g) => createRenderer(g, backend)] })
  const texture = await game.get(Renderer).loadTexture('a.png', { frameWidth: 16, frameHeight: 16 })
  return { game, texture, sprites, writes, particleDraws }
}

it('draws Interpolate entities between their last two fixed ticks', async () => {
  const { game, texture, sprites } = await setup()
  const e = game.world.spawn([Position], [Sprite, { w: 1, h: 1, texture }], [Interpolate])
  game.system(() => void (Position.x[e] += 10), 'fixed')
  game.step(0.1) // one tick: 0 → 10, frame lands right on the tick, so it draws the previous tick's 0
  game.step(0.05) // half way to the next tick
  expect(sprites).toEqual([0, 5])
})

it('writes bursts into a ring buffer and skips a pool once its particles have died', async () => {
  const { game, texture, writes, particleDraws } = await setup()
  const renderer = game.get(Renderer)
  renderer.burst({ x: 0, y: 0, texture, count: 8000, life: 1 })
  renderer.burst({ x: 0, y: 0, texture, count: 500, life: 1 }) // past the 8192-slot ring: wraps to the start
  expect(writes).toEqual([[0, 8000], [8000, 192], [0, 308]])
  game.step(0.5)
  expect(particleDraws).toEqual([8192])
  game.step(0.6) // every particle lived at most 1 s
  expect(particleDraws).toEqual([8192])
})

it('draws y-sorted layers by bottom edge, negatives included, keeping ties in last frame order', async () => {
  const { game, texture, sprites } = await setup()
  const renderer = game.get(Renderer)
  renderer.ySort.add(0)
  // x tells them apart; bottoms are y + 5.
  const at = (x: number, y: number) => game.world.spawn([Position, { x, y }], [Sprite, { w: 10, h: 10, texture }])
  at(1, 300)
  at(2, -40)
  at(3, 7000)
  at(4, -40) // ties with 2
  at(5, 0.5)
  game.step(0)
  expect(sprites).toEqual([2, 4, 5, 1, 3])
  sprites.length = 0
  game.step(0)
  expect(sprites).toEqual([2, 4, 5, 1, 3])
})

it('sorts thousands of sprites spread over a wide range (several radix passes)', async () => {
  const { game, texture, sprites } = await setup()
  game.get(Renderer).ySort.add(0)
  const ys = new Map<number, number>()
  for (let i = 0; i < 5000; i++) {
    const y = (Math.random() - 0.5) * 200_000
    ys.set(i, y)
    game.world.spawn([Position, { x: i, y }], [Sprite, { w: 1, h: 1, texture }])
  }
  game.step(0)
  const drawn = sprites.map((x) => ys.get(x)!)
  expect(drawn.length).toBe(5000)
  expect(drawn.every((y, i) => i === 0 || drawn[i - 1] <= y + 1 / 16)).toBe(true)
})

it('draws sprites without a texture as solid rectangles (texture 0 is a white pixel)', async () => {
  const { game, texture, sprites } = await setup()
  expect(texture).toBeGreaterThan(0)
  game.world.spawn([Position, { x: 7 }], [Sprite, { w: 10, h: 10, tint: 0xff0000 }])
  game.step(0.1)
  expect(sprites).toEqual([7])
})
