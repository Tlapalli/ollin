import { describe, expect, it } from 'vitest'
import { createGame, token } from './core'
import { defineComponent, f32, u8, World } from './ecs'
import { mat4, ortho } from './math'

const project = (m: Float32Array, x: number, y: number) => [m[0] * x + m[12], m[5] * y + m[13]]

describe('ortho', () => {
  it('maps screen space (top-left origin) to clip space', () => {
    const m = ortho(mat4(), 0, 800, 600, 0, -1, 1)
    const close = ([x, y]: number[], ex: number, ey: number) => {
      expect(x).toBeCloseTo(ex, 5)
      expect(y).toBeCloseTo(ey, 5)
    }
    close(project(m, 0, 0), -1, 1)
    close(project(m, 800, 600), 1, -1)
  })
})

describe('World', () => {
  const Pos = defineComponent({ x: f32, y: f32 })
  const Vel = defineComponent({ x: f32 })
  const Tag = defineComponent({ on: u8 })

  it('keeps queries in sync with spawn, add, remove and despawn', () => {
    const world = new World(2)
    const moving = world.query(Pos, Vel)
    const a = world.spawn([Pos, { x: 1, y: 2 }], [Vel])
    const b = world.spawn([Pos])
    expect(moving.entities).toEqual([a])
    expect([Pos.x[a], Pos.y[a], Vel.x[a]]).toEqual([1, 2, 0])

    world.add(b, Vel, { x: 5 })
    expect(moving.entities).toEqual([a, b])
    world.remove(a, Vel)
    expect(moving.entities).toEqual([b])
    world.despawn(b)
    expect(moving.entities).toEqual([])
    expect(world.count).toBe(1)
  })

  it('grows storage without losing data and fills late queries', () => {
    const world = new World(2)
    const ids = [1, 2, 3, 4, 5].map((x) => world.spawn([Pos, { x }], [Tag]))
    expect(Pos.x.length).toBeGreaterThanOrEqual(5)
    expect(ids.map((e) => Pos.x[e])).toEqual([1, 2, 3, 4, 5])
    expect(world.query(Tag, Pos).entities).toHaveLength(5)
    expect(world.query(Pos, Tag)).toBe(world.query(Tag, Pos))
  })

  it('gives a new World fresh component storage', () => {
    const old = new World()
    old.spawn([Pos, { x: 7 }])
    const world = new World()
    const q = world.query(Pos)
    const e = world.spawn([Pos])
    expect(q.entities).toEqual([e])
    expect(Pos.x[e]).toBe(0)
  })

  it('recycles despawned ids with zeroed data', () => {
    const world = new World()
    const e = world.spawn([Pos, { x: 9 }])
    world.despawn(e)
    const f = world.spawn([Pos])
    expect(f).toBe(e)
    expect(Pos.x[f]).toBe(0)
  })
})

describe('createGame', () => {
  it('runs plugins, resources and systems in update → render order', async () => {
    const Log = token<string[]>('Log')
    const game = await createGame({
      canvas: {} as HTMLCanvasElement,
      plugins: [(g) => g.set(Log, [])],
    })
    const log = game.get(Log)
    game.system(() => log.push('render'), 'render')
    game.system((dt) => log.push(`update ${dt}`))
    game.step(0.016)
    expect(log).toEqual(['update 0.016', 'render'])
    expect(() => game.get(token('Missing'))).toThrow('Missing')
  })

  it('runs fixed systems at a constant rate and carries the remainder', async () => {
    const game = await createGame({ canvas: {} as HTMLCanvasElement, fixedDt: 0.25 })
    let steps = 0
    game.system(() => steps++, 'fixed')
    game.step(0.625)
    expect(steps).toBe(2)
    game.step(0.125)
    expect(steps).toBe(3)
  })
})
