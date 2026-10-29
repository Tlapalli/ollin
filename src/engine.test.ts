import { describe, expect, it } from 'vitest'
import { createGame, token } from './core'
import { mat4, ortho } from './math'
import { Sprites } from './sprites'

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

describe('Sprites', () => {
  it('grows when full without losing data', () => {
    const s = new Sprites(2)
    s.add(1, 2, 3, 4)
    s.add(5, 6, 7, 8, 9)
    s.add(10, 11, 12, 13)
    expect(s.capacity).toBe(4)
    expect([...s.x.subarray(0, 3)]).toEqual([1, 5, 10])
    expect(s.z[1]).toBe(9)
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
})
