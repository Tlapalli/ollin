import { expect, test } from 'vitest'
import { Position } from './components'
import { createGame } from './core'
import { after, ease, every, mixColor, tween } from './tween'

const newGame = () => createGame({ canvas: {} as HTMLCanvasElement, fixedDt: 0.1 })

test('tween reaches its target, eases, calls onDone and removes itself', async () => {
  const game = await newGame()
  const e = game.world.spawn([Position, { x: 0, y: 10 }])
  let done = 0
  tween(game, e, Position, { x: 100 }, { duration: 1, ease: ease.in, onDone: () => done++ })
  game.step(0.5)
  expect(Position.x[e]).toBeCloseTo(25)
  expect(Position.y[e]).toBe(10)
  game.step(0.6)
  game.step(0.5)
  expect(Position.x[e]).toBe(100)
  expect(done).toBe(1)
})

test('tween stops when the entity is despawned, and cancels', async () => {
  const game = await newGame()
  const e = game.world.spawn([Position])
  tween(game, e, Position, { x: 100 }, { duration: 1 })
  game.world.despawn(e)
  const f = game.world.spawn([Position]) // reuses the id; the old tween must not move it
  expect(f).toBe(e)
  game.step(0.5)
  expect(Position.x[f]).toBe(0)
  const cancel = tween(game, f, Position, { x: 100 }, { duration: 1 })
  cancel()
  game.step(0.5)
  expect(Position.x[f]).toBe(0)
})

test('after fires once, every repeats, both end with the scene', async () => {
  const game = await newGame()
  const log: string[] = []
  await game.scene((g) => {
    after(g, 1, () => log.push('after'))
    every(g, 0.5, () => log.push('every'))
  })
  game.step(0.6)
  game.step(0.6)
  game.step(0.6)
  expect(log).toEqual(['every', 'after', 'every', 'every']) // after was registered first, so it runs first in a frame
  await game.scene(() => {})
  game.step(5)
  expect(log.length).toBe(4)
})

test('mixColor blends channels', () => {
  expect(mixColor(0x000000, 0xff8040, 0.5)).toBe(0x804020)
  expect(mixColor(0x123456, 0xabcdef, 0)).toBe(0x123456)
})
