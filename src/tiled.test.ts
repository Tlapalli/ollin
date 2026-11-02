import { describe, expect, it } from 'vitest'
import { createCamera } from './camera'
import { Position, Sprite } from './components'
import { World } from './ecs'
import { mat4 } from './math'
import { spawnTilemap, type TiledMap } from './tiled'

const FLIPPED_H = 0x80000000

const map: TiledMap = {
  orientation: 'orthogonal',
  width: 3,
  height: 2,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [
    { firstgid: 1, image: 'a.png' },
    { firstgid: 10, image: 'b.png' },
  ],
  layers: [
    { type: 'tilelayer', name: 'ground', width: 3, data: [0, 2, 0, 11, 0, (1 | FLIPPED_H) >>> 0] },
    { type: 'objectgroup', name: 'things', objects: [{ id: 7, name: 'player', class: 'spawn', x: 5, y: 6, width: 0, height: 0, properties: [{ name: 'hp', value: 3 }] }] },
    { type: 'group', name: 'g', layers: [{ type: 'tilelayer', name: 'solid', visible: false, width: 3, data: [1, 0, 0, 0, 0, 0] }] },
  ],
}

describe('spawnTilemap', () => {
  it('spawns tiles centered in their cells with frames per tileset and z per layer', () => {
    const world = new World()
    const result = spawnTilemap(world, map, [
      { firstgid: 1, texture: 100 },
      { firstgid: 10, texture: 200 },
    ], { z: 5 })

    const [a, b, c] = result.layers.ground
    expect([Position.x[a], Position.y[a], Position.z[a]]).toEqual([24, 8, 5])
    expect([Sprite.texture[a], Sprite.frame[a]]).toEqual([100, 1])
    expect([Sprite.texture[b], Sprite.frame[b], Position.y[b]]).toEqual([200, 1, 24])
    expect([Sprite.frame[c], Sprite.flipX[c], Sprite.flipY[c]]).toEqual([0, 1, 0]) // flip flags become Sprite.flipX/flipY
    expect(Sprite.flipX[a]).toBe(0)
    // tileAt finds the tile under a world point, -1 for empty cells, outside the map and despawned tiles.
    expect(result.tileAt('ground', 20, 2)).toBe(a)
    expect(result.tileAt('ground', 47, 31)).toBe(c)
    expect(result.tileAt('ground', 2, 2)).toBe(-1)
    expect(result.tileAt('ground', -1, 2)).toBe(-1)
    world.despawn(a)
    expect(result.tileAt('ground', 20, 2)).toBe(-1)
    expect(result.tileAt('solid', 2, 2)).toBeGreaterThanOrEqual(0) // hidden layers too, for collision
    expect(result.cellAt(40, 20)).toEqual({ col: 2, row: 1 })
    expect(result.cellCenter(2, 1)).toEqual({ x: 40, y: 24 })
    expect([result.cols, result.rows]).toEqual([3, 2])
    expect(result).toMatchObject({ width: 48, height: 32, tileWidth: 16 })
    expect(result.objects).toEqual([
      { id: 7, name: 'player', type: 'spawn', layer: 'things', z: 6, x: 5, y: 6, width: 0, height: 0, properties: { hp: 3 } },
    ])
  })

  it('spawns hidden layers without a Sprite and rejects unsupported maps', () => {
    const world = new World()
    const [solid] = spawnTilemap(world, map, [{ firstgid: 1, texture: 0 }]).layers.solid
    expect(world.has(solid, Position)).toBe(true)
    expect(world.has(solid, Sprite)).toBe(false)
    expect(Position.z[solid]).toBe(2)
    expect(() => spawnTilemap(world, { ...map, orientation: 'hexagonal' }, [])).toThrow('orthogonal')
    expect(() => spawnTilemap(world, { ...map, infinite: true }, [])).toThrow('infinite')
  })
})

describe('spawnTilemap (isometric)', () => {
  it('places tiles on diamond cells, bottom-aligns tall tiles and converts object positions', () => {
    const world = new World()
    // 2x2 map of 64x32 diamonds; the tileset images are 64x64 blocks.
    const iso: TiledMap = {
      orientation: 'isometric',
      width: 2,
      height: 2,
      tilewidth: 64,
      tileheight: 32,
      tilesets: [{ firstgid: 1, image: 'blocks.png' }],
      layers: [
        { type: 'tilelayer', name: 'ground', width: 2, data: [1, 1, 1, 1] },
        { type: 'objectgroup', name: 'things', objects: [{ id: 1, name: 'player', x: 32, y: 32, width: 0, height: 0 }] },
      ],
    }
    const result = spawnTilemap(world, iso, [{ firstgid: 1, texture: 0, tileWidth: 64, tileHeight: 64 }])
    const [a, b, c, d] = result.layers.ground
    // Cell (0,0) is the top diamond: top corner at (64, 0), bottom corner at (64, 32), so the block's center is 32 above that.
    expect([Position.x[a], Position.y[a], Sprite.w[a], Sprite.h[a]]).toEqual([64, 0, 64, 64])
    expect([Position.x[b], Position.y[b]]).toEqual([96, 16]) // (col 1, row 0) is down-right
    expect([Position.x[c], Position.y[c]]).toEqual([32, 16]) // (col 0, row 1) is down-left
    expect([Position.x[d], Position.y[d]]).toEqual([64, 32])
    expect(result).toMatchObject({ width: 128, height: 64 })
    // tileAt tests the diamond: the top diamond spans (32..96, 0..32); just left of it is empty space.
    expect(result.tileAt('ground', 64, 2)).toBe(a)
    expect(result.tileAt('ground', 96, 16)).toBe(b)
    expect(result.tileAt('ground', 40, 2)).toBe(-1)
    // cellAt and cellCenter convert between world points and diamond cells, both ways.
    expect(result.cellAt(96, 20)).toEqual({ col: 1, row: 0 })
    expect(result.cellCenter(1, 0)).toEqual({ x: 96, y: 32 })
    expect(result.cellAt(96, 32)).toEqual({ col: 1, row: 0 })
    // The object sits at grid point (1, 1) in tile heights: the corner all four cells share.
    expect(result.objects[0]).toMatchObject({ x: 64, y: 32 })
  })
})

describe('Camera', () => {
  it('maps the default view 1:1 and converts screen to world with pan and zoom', () => {
    const camera = createCamera(800, 600)
    const m = camera.viewProj(mat4())
    expect(m[0] * 0 + m[12]).toBeCloseTo(-1, 5)
    expect(camera.toWorld(0, 0)).toEqual({ x: 0, y: 0 })

    camera.x = 1000
    camera.y = 500
    camera.zoom = 2
    expect(camera.toWorld(400, 300)).toEqual({ x: 1000, y: 500 })
    expect(camera.toWorld(0, 0)).toEqual({ x: 800, y: 350 })
  })
})
