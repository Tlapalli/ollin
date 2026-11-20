import { expect, it } from 'vitest'
import { parseAtlas } from './atlas'

it('parses Aseprite array JSON with trimmed frames and tags', () => {
  const atlas = parseAtlas({
    frames: [
      { filename: 'hero 0', frame: { x: 0, y: 0, w: 10, h: 12 }, trimmed: true, spriteSourceSize: { x: 3, y: 4, w: 10, h: 12 }, sourceSize: { w: 16, h: 16 }, duration: 100 },
      { filename: 'hero 1', frame: { x: 10, y: 0, w: 16, h: 16 }, sourceSize: { w: 16, h: 16 }, duration: 100 },
      { filename: 'hero 2', frame: { x: 26, y: 0, w: 16, h: 16 }, sourceSize: { w: 16, h: 16 }, duration: 200 },
    ],
    meta: { image: 'hero.png', frameTags: [{ name: 'run', from: 1, to: 2, direction: 'forward' }] },
  })
  expect(atlas.image).toBe('hero.png')
  expect(atlas.frames[0]).toMatchObject({ name: 'hero 0', x: 0, w: 10, h: 12, sourceW: 16, sourceH: 16, offsetX: 3, offsetY: 4 })
  expect(atlas.tags.run).toEqual({ start: 1, count: 2, fps: 2000 / 300 })
})

it('parses TexturePacker hash JSON in key order, untrimmed frames filling their source', () => {
  const atlas = parseAtlas({
    frames: { 'sword.png': { frame: { x: 4, y: 8, w: 20, h: 30 } }, 'shield.png': { frame: { x: 30, y: 8, w: 24, h: 24 } } },
    meta: { image: 'items.png' },
  })
  expect(atlas.frames.map((f) => f.name)).toEqual(['sword.png', 'shield.png'])
  expect(atlas.frames[1]).toMatchObject({ x: 30, y: 8, w: 24, h: 24, sourceW: 24, sourceH: 24, offsetX: 0, offsetY: 0 })
  expect(atlas.tags).toEqual({})
})

it('rejects JSON that is not a spritesheet', () => {
  expect(() => parseAtlas({ hello: 1 })).toThrow(/spritesheet/)
})
