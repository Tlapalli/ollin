import { describe, expect, it } from 'vitest'
import { Animation, animation, attach, hierarchy, hit, overlaps, Parent, Position, Rotation, Sprite } from './components'
import type { Game } from './core'
import { defineComponent, u16, World } from './ecs'
import { DEFAULT_CHARS, spawnText, type Font } from './text'

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

describe('hierarchy', () => {
  const setup = () => {
    const world = new World()
    const game = { world, fixedAlpha: 0 } as never as Game
    return { world, step: hierarchy(game) }
  }

  it('places children at the parent plus an offset turned by its rotation, chains included, in any order', () => {
    const { world, step } = setup()
    const hero = world.spawn([Position, { x: 100, y: 50, z: 2 }], [Rotation, { angle: Math.PI / 2 }])
    const hand = world.spawn([Position], [Rotation])
    const sword = world.spawn([Position])
    attach(world, sword, hand, { x: 5 }) // the grandchild is attached first, so the query meets it before its parent
    attach(world, hand, hero, { x: 10, z: 1, angle: 0.5 })
    step(0)
    const round = (e: number) => [Position.x[e], Position.y[e], Position.z[e]].map((v) => Math.round(v * 1000) / 1000)
    expect(round(hand)).toEqual([100, 60, 3]) // (10, 0) turned 90 degrees is (0, 10)
    expect(Rotation.angle[hand]).toBeCloseTo(Math.PI / 2 + 0.5)
    expect(round(sword)).toEqual([round(hand)[0] + 5 * Math.cos(Math.PI / 2 + 0.5), round(hand)[1] + 5 * Math.sin(Math.PI / 2 + 0.5), 3].map((v) => Math.round(v * 1000) / 1000))
    Position.x[hero] = 0
    step(0)
    expect(Position.x[hand]).toBeCloseTo(0)
  })

  it('despawns children with their parent, down the chain, and is not fooled by a recycled id', () => {
    const { world, step } = setup()
    const boss = world.spawn([Position])
    const bar = world.spawn([Position])
    const label = world.spawn([Position])
    attach(world, bar, boss, { y: -20 })
    attach(world, label, bar)
    world.despawn(boss)
    const recycled = world.spawn([Position]) // takes boss's id
    expect(recycled).toBe(boss)
    step(0)
    expect([world.has(bar, Parent), world.has(label, Parent), world.count]).toEqual([false, false, 1])
  })
})

describe('spawnText', () => {
  // 10 px font: every glyph advances 6 px and sits in a 8x14 cell.
  const glyphs = new Map([...DEFAULT_CHARS].map((c, i) => [c, i]))
  const font: Font = { texture: 7, size: 10, cellWidth: 8, cellHeight: 14, lineHeight: 12, glyphs, advances: Array(glyphs.size).fill(6) }

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

  it('maps accents and ñ (composed or not) to their glyphs, unknown characters to ?', () => {
    const world = new World()
    const text = spawnText(world, font, 'ñá\u0065\u0301ā→')
    expect(text.entities.map((e) => Sprite.frame[e])).toEqual(['ñ', 'á', 'é', 'ā', '?'].map((c) => glyphs.get(c)))
  })

  it('wraps at spaces to maxWidth, breaks words wider than a line, and keeps explicit newlines', () => {
    const world = new World()
    const lines = (value: string, maxWidth: number) => {
      const text = spawnText(world, font, value, { maxWidth })
      const rows = new Map<number, string>()
      for (const e of text.entities) rows.set(Position.y[e], (rows.get(Position.y[e]) ?? '') + [...glyphs.keys()][Sprite.frame[e]])
      return { rows: [...rows.values()], width: text.width }
    }
    // 6 px per character: "the quick" is 54 px, wider than 40.
    expect(lines('the quick fox', 40)).toEqual({ rows: ['the', 'quick', 'fox'], width: 30 })
    expect(lines('the fox ran', 48)).toEqual({ rows: ['thefox', 'ran'], width: 42 }) // spaces spawn no sprite but take 6 px
    expect(lines('abcdefghij yo', 40).rows).toEqual(['abcdef', 'ghij', 'yo'])
    expect(lines('ab\ncd ef', 100).rows).toEqual(['ab', 'cdef'])
  })

  it('tints and fades the whole text, and keeps the style across set', () => {
    const world = new World()
    const text = spawnText(world, font, 'ab', { tint: 0x112233 })
    text.alpha = 0.5
    text.tint = 0xf28c28
    text.set('abc')
    expect(text.entities.map((e) => [Sprite.tint[e], Sprite.alpha[e]])).toEqual(Array(3).fill([0xf28c28, 0.5]))
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
