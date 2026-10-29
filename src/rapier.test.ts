import { describe, expect, it } from 'vitest'
import { Position } from './components'
import { createGame } from './core'
import { BodyType, Collider, Physics, rapier, RigidBody, Shape } from './rapier'

const setup = async () => {
  const game = await createGame({ canvas: {} as HTMLCanvasElement, plugins: [rapier({ scale: 100 })] })
  const { world } = game
  world.spawn(
    [Position, { x: 0, y: 500 }],
    [RigidBody, { type: BodyType.Fixed }],
    [Collider, { shape: Shape.Box, w: 2000, h: 100 }],
  )
  const ball = world.spawn([Position, { x: 0, y: 0 }], [RigidBody], [Collider, { shape: Shape.Ball, w: 100 }])
  return { game, world, ball, physics: game.get(Physics) }
}

describe('rapier plugin', () => {
  it('drops a dynamic body onto a fixed one and writes Position back', async () => {
    const { game, ball } = await setup()
    for (let i = 0; i < 180; i++) game.step(game.fixedDt)
    // Ground top is at y = 450 and the ball radius is 50, so it rests at y ≈ 400.
    expect(Position.y[ball]).toBeCloseTo(400, -1)
  })

  it('removes the body on despawn and rebuilds it for a recycled id', async () => {
    const { game, world, ball, physics } = await setup()
    game.step(game.fixedDt)
    const first = physics.body(ball)
    expect(first).toBeDefined()

    world.despawn(ball)
    game.step(game.fixedDt)
    expect(physics.body(ball)).toBeUndefined()
    expect(physics.world.bodies.len()).toBe(1)

    const again = world.spawn([Position, { x: 0, y: 0 }], [RigidBody], [Collider, { shape: Shape.Ball, w: 100 }])
    expect(again).toBe(ball)
    game.step(game.fixedDt)
    expect(physics.body(again)).toBeDefined()
    expect(physics.world.bodies.len()).toBe(2)
  })
})
