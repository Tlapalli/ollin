import { expect, test } from 'vitest'
import { Position, Sprite } from './components'
import { pick } from './devtools'
import { World } from './ecs'

test('pick finds the topmost sprite under a point, in screen space for screen layers', () => {
  const world = new World()
  const back = world.spawn([Position, { x: 100, y: 100, z: 0 }], [Sprite, { w: 40, h: 40 }])
  const front = world.spawn([Position, { x: 110, y: 100, z: 1 }], [Sprite, { w: 40, h: 40 }])
  const hud = world.spawn([Position, { x: 10, y: 10, z: 100 }], [Sprite, { w: 20, h: 20 }])
  const all = world.query(Position, Sprite).entities
  const screen = new Set([100])
  const at = (sx: number, sy: number, wx = sx, wy = sy) => pick(all, sx, sy, { x: wx, y: wy }, screen)

  expect(at(105, 100)).toBe(front)
  expect(at(85, 100)).toBe(back)
  expect(at(300, 300)).toBe(-1)
  // The camera moved: world point differs from the canvas point, but the HUD stays where it is on screen.
  expect(at(10, 10, 500, 500)).toBe(hud)
  expect(at(500, 500, 85, 100)).toBe(back)
})
