import { Position, Sprite } from './components'
import type { Game } from './core'
import type { Entity, World } from './ecs'
import { Renderer } from './render'

/** The subset of the Tiled JSON map format (.tmj) that Ollin reads. */
export interface TiledMap {
  orientation: string
  infinite?: boolean
  width: number
  height: number
  tilewidth: number
  tileheight: number
  layers: TiledLayer[]
  tilesets: TiledTileset[]
}

/** A layer of a Tiled JSON map: tiles, objects, a group of layers, or an image (ignored). */
export type TiledLayer =
  | { type: 'tilelayer'; name: string; visible?: boolean; offsetx?: number; offsety?: number; width: number; data: number[] | string; encoding?: string }
  | { type: 'objectgroup'; name: string; offsetx?: number; offsety?: number; objects: TiledRawObject[] }
  | { type: 'group'; name: string; layers: TiledLayer[] }
  | { type: 'imagelayer'; name: string }

/** A tileset reference in a Tiled JSON map. */
export interface TiledTileset {
  firstgid: number
  /** External tileset file; only JSON (.tsj) is supported. */
  source?: string
  image?: string
  tilewidth?: number
  tileheight?: number
  margin?: number
  spacing?: number
}

interface TiledRawObject {
  id: number
  name: string
  type?: string
  class?: string
  x: number
  y: number
  width: number
  height: number
  point?: boolean
  properties?: { name: string; value: unknown }[]
}

/** An object from a Tiled object layer (spawn points, triggers), in world pixels. `properties` holds its custom properties. */
export interface TiledObject {
  id: number
  name: string
  /** Tiled "class" (or "type" in older versions). */
  type: string
  layer: string
  /** z of the object layer, to spawn things between tile layers. */
  z: number
  x: number
  y: number
  width: number
  height: number
  properties: Record<string, unknown>
}

/** A spawned Tiled map: its size, tile entities by layer, objects, and lookups for collision and grid logic. */
export interface Tilemap {
  /** Map size in pixels. */
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  /** Tile entities by layer name. Hidden layers get `Position` only (handy for collision layers). */
  layers: Record<string, Entity[]>
  objects: TiledObject[]
  /**
   * The tile of `layer` under a world point, or -1: `map.tileAt('walls', x, y + h / 2) >= 0` tests a character's feet.
   * Isometric maps test the cell's diamond, not the (taller) tile image. Despawned tiles read as -1.
   */
  tileAt(layer: string, x: number, y: number): Entity
  /** Map size in cells. */
  cols: number
  rows: number
  /** The grid cell under a world point (it may be outside the map), for pathfinding and grid logic. */
  cellAt(x: number, y: number): { col: number; row: number }
  /** The world point at the center of a cell (of its diamond on isometric maps): where things standing on it sit. */
  cellCenter(col: number, row: number): { x: number; y: number }
}

/** A tileset already loaded as a texture: gids from `firstgid` map to frames 0, 1, 2... */
export interface LoadedTileset {
  firstgid: number
  texture: number
  /** Tile image size when it differs from the map grid (tall isometric blocks). Default: the map's tile size. */
  tileWidth?: number
  tileHeight?: number
}

// Tiled stores flip/rotation flags in the top four bits of each gid.
// ponytail: horizontal and vertical flips map to Sprite.flipX/flipY; diagonal flips (90° rotations) are ignored
const GID_MASK = 0x0fffffff
const FLIP_X = 0x80000000
const FLIP_Y = 0x40000000

/**
 * Spawns one entity per non-empty tile with `z = baseZ + layer index` (object layers take an index too,
 * so objects can sit between tile layers). Like Tiled, a tile image sits on the bottom of its cell, so tall
 * tiles grow upward. Orthogonal cells are the grid squares; isometric cells are diamonds, and object
 * positions are converted to screen pixels.
 */
// ponytail: one entity per tile; switch to chunked static meshes if maps reach hundreds of thousands of tiles
export function spawnTilemap(world: World, map: TiledMap, tilesets: LoadedTileset[], options: { z?: number } = {}): Tilemap {
  const baseZ = options.z ?? 0
  const iso = map.orientation === 'isometric'
  if (!iso && map.orientation !== 'orthogonal') throw new Error(`Tiled: only orthogonal and isometric maps are supported, got "${map.orientation}"`)
  if (map.infinite) throw new Error('Tiled: infinite maps are not supported; disable "Infinite" in the map properties')

  const { tilewidth: tw, tileheight: th } = map
  const sorted = [...tilesets].sort((a, b) => b.firstgid - a.firstgid)
  // Isometric: the top corner of cell (col, row) is at ((col - row) * tw/2 + originX, (col + row) * th/2).
  const originX = (map.height * tw) / 2
  /** Per tile layer: the entity in each cell (-1 if empty), its generation when spawned, and the layer offset. */
  const grids = new Map<string, { cells: Int32Array; generations: Uint32Array; ox: number; oy: number }>()
  const cellAt = (x: number, y: number) => {
    if (!iso) return { col: Math.floor(x / tw), row: Math.floor(y / th) }
    const u = (x - originX) / (tw / 2)
    const v = y / (th / 2)
    return { col: Math.floor((v + u) / 2), row: Math.floor((v - u) / 2) }
  }
  const cellCenter = (col: number, row: number) =>
    iso ? { x: (col - row) * (tw / 2) + originX, y: (col + row + 1) * (th / 2) } : { x: (col + 0.5) * tw, y: (row + 0.5) * th }
  const tileAt = (layer: string, px: number, py: number): Entity => {
    const grid = grids.get(layer)
    if (!grid) throw new Error(`Tiled: no tile layer named "${layer}"`)
    const { col, row } = cellAt(px - grid.ox, py - grid.oy)
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) return -1
    const e = grid.cells[row * map.width + col]
    return e >= 0 && world.generation(e) === grid.generations[row * map.width + col] ? e : -1
  }
  const size = iso ? { width: ((map.width + map.height) * tw) / 2, height: ((map.width + map.height) * th) / 2 } : { width: map.width * tw, height: map.height * th }
  const result: Tilemap = { ...size, tileWidth: tw, tileHeight: th, cols: map.width, rows: map.height, layers: {}, objects: [], tileAt, cellAt, cellCenter }
  /** Bottom-center of a cell in pixels. */
  const cellBottom = (col: number, row: number) =>
    iso ? { x: (col - row) * (tw / 2) + originX, y: (col + row + 2) * (th / 2) } : { x: col * tw + tw / 2, y: (row + 1) * th }
  let index = 0

  const visit = (layer: TiledLayer) => {
    if (layer.type === 'group') return layer.layers.forEach(visit)
    if (layer.type === 'imagelayer') return
    const z = baseZ + index++
    const ox = layer.offsetx ?? 0
    const oy = layer.offsety ?? 0

    if (layer.type === 'objectgroup') {
      for (const o of layer.objects) {
        const properties = Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value]))
        // Isometric objects are stored in grid space where both axes are measured in tile heights.
        const x = iso ? (o.x / th - o.y / th) * (tw / 2) + originX : o.x
        const y = iso ? (o.x / th + o.y / th) * (th / 2) : o.y
        result.objects.push({ id: o.id, name: o.name, type: o.class ?? o.type ?? '', layer: layer.name, z, x: x + ox, y: y + oy, width: o.width, height: o.height, properties })
      }
      return
    }

    if (!Array.isArray(layer.data)) throw new Error(`Tiled: layer "${layer.name}" uses ${layer.encoding} encoding; save the map with CSV layer format`)
    const entities = (result.layers[layer.name] ??= [])
    let grid = grids.get(layer.name)
    if (!grid) {
      grid = { cells: new Int32Array(map.width * map.height).fill(-1), generations: new Uint32Array(map.width * map.height), ox, oy }
      grids.set(layer.name, grid)
    }
    const { cells, generations } = grid
    layer.data.forEach((raw, i) => {
      const gid = raw & GID_MASK
      if (!gid) return
      const tileset = sorted.find((t) => t.firstgid <= gid)
      if (!tileset) return
      const w = tileset.tileWidth ?? tw
      const h = tileset.tileHeight ?? th
      const bottom = cellBottom(i % layer.width, Math.floor(i / layer.width))
      const x = bottom.x + ox
      const y = bottom.y - h / 2 + oy
      const e =
        layer.visible === false
          ? world.spawn([Position, { x, y, z }])
          : world.spawn(
              [Position, { x, y, z }],
              [Sprite, { w, h, texture: tileset.texture, frame: gid - tileset.firstgid, flipX: raw & FLIP_X ? 1 : 0, flipY: raw & FLIP_Y ? 1 : 0 }],
            )
      entities.push(e)
      cells[i] = e
      generations[i] = world.generation(e)
    })
  }

  map.layers.forEach(visit)
  return result
}

/** Fetches a Tiled JSON map, loads its tilesets as textures and spawns it. Needs the `webgl2` plugin. */
export async function loadTilemap(game: Game, url: string, options?: { z?: number }): Promise<Tilemap> {
  const mapUrl = new URL(url, globalThis.location?.href)
  const map: TiledMap = await (await fetch(mapUrl)).json()
  const renderer = game.get(Renderer)

  const tilesets = await Promise.all(
    map.tilesets.map(async (ref): Promise<LoadedTileset> => {
      let tileset = ref
      let base = mapUrl
      if (ref.source) {
        if (!ref.source.endsWith('.tsj') && !ref.source.endsWith('.json'))
          throw new Error(`Tiled: external tileset "${ref.source}" must be JSON (.tsj); export it as JSON or embed it in the map`)
        base = new URL(ref.source, mapUrl)
        tileset = { ...(await (await fetch(base)).json()), firstgid: ref.firstgid }
      }
      if (!tileset.image) throw new Error('Tiled: image collection tilesets are not supported')
      const tileWidth = tileset.tilewidth ?? map.tilewidth
      const tileHeight = tileset.tileheight ?? map.tileheight
      const texture = await renderer.loadTexture(new URL(tileset.image, base).href, {
        frameWidth: tileWidth,
        frameHeight: tileHeight,
        margin: tileset.margin,
        spacing: tileset.spacing,
        filter: 'nearest',
      })
      return { firstgid: ref.firstgid, texture, tileWidth, tileHeight }
    }),
  )

  return spawnTilemap(game.world, map, tilesets, options)
}
