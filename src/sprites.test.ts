import { describe, expect, it } from 'vitest'
import { Animation, animation, hit, overlaps, Position, Sprite } from './components'
import { defineComponent, u16, World } from './ecs'
import { spawnText, type Font } from './text'

describe('component defaults', () => {
  it('fills fields left out with the defaults, or 0', () => {
    const Health = defineComponent({ hp: u16, armor: u16 }, { hp: 3 })
    const world = new World()
    const e = world.spawn([Health, { armor: 1 }], [Sprite])
    expect([Health.hp[e], Health.armor[e]]).toEqual([3, 1])
    expect([Sprite.tint[e], Sprite.alpha[e], Sprite.flipX[e]]).toEqual([0xffffff, 1, 0])
  })
})

describe('animation', () => {
  it('loops through frames, or holds the last one when once is set', () => {
    const world = new World()
    const step = animation(world)
    const loop = world.spawn([Sprite], [Animation, { start: 4, count: 3, fps: 10 }])
    const once = world.spawn([Sprite], [Animation, { start: 0, count: 2, fps: 10, once: 1 }])
    const frames: number[][] = []
    for (let i = 0; i < 4; i++) {
      step(0.1)
      frames.push([Sprite.frame[loop], Sprite.frame[once]])
    }
    expect(frames).toEqual([[5, 1], [6, 1], [4, 1], [5, 1]])
  })
})

describe('spawnText', () => {
  // 10 px font: every glyph advances 6 px and sits in a 8x14 cell.
  const font: Font = { texture: 7, size: 10, cellWidth: 8, cellHeight: 14, lineHeight: 12, advances: Array(95).fill(6) }

  it('spawns one sprite per visible character, laid out by advance and line', () => {
    const world = new World()
    const text = spawnText(world, font, 'Hi y\nA', { x: 100, y: 50, size: 20, tint: 0xb5302a })
    expect(text.entities.length).toBe(4) // the space is skipped
    const [h, i, y, a] = text.entities
    expect([Sprite.frame[h], Sprite.frame[a], Sprite.texture[h], Sprite.tint[h]]).toEqual([40, 33, 7, 0xb5302a])
    expect([Sprite.w[h], Sprite.h[h]]).toEqual([16, 28]) // cells scale with size / font.size
    expect(Position.x[i] - Position.x[h]).toBe(12)
    expect(Position.x[y] - Position.x[h]).toBe(36)
    expect(Position.y[a] - Position.y[h]).toBe(24) // second line
    expect(text.width).toBe(48)
  })

  it('replaces its sprites on set and centers lines with align', () => {
    const world = new World()
    const text = spawnText(world, font, 'abc', { x: 0, align: 'center' })
    text.set('ab')
    expect(world.count).toBe(2)
    expect(Position.x[text.entities[0]]).toBe(-6 - 1 + 4) // half of 12 px to the left, glyph padding, half a cell
  })
})

it('overlaps and hit test sprite boxes, with an inset for forgiving hits', () => {
  const world = new World()
  const a = world.spawn([Position, { x: 0, y: 0 }], [Sprite, { w: 10, h: 10 }])
  const b = world.spawn([Position, { x: 8, y: 0 }], [Sprite, { w: 10, h: 10 }])
  const c = world.spawn([Position, { x: 30, y: 0 }], [Sprite, { w: 10, h: 10 }])
  expect(overlaps(a, b)).toBe(true)
  expect(overlaps(a, b, 2)).toBe(false) // 2 px inset per side: 6 px boxes, 8 px apart
  expect(overlaps(a, c)).toBe(false)
  expect(hit(a, [a, c, b])).toBe(b)
  expect(hit(a, [c])).toBe(-1)
})
