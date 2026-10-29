import { Position, Sprite } from './components'
import type { Game } from './core'
import type { Entity, World } from './ecs'
import { Renderer } from './webgl2'

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

export type TiledLayer =
  | { type: 'tilelayer'; name: string; visible?: boolean; offsetx?: number; offsety?: number; width: number; data: number[] | string; encoding?: string }
  | { type: 'objectgroup'; name: string; offsetx?: number; offsety?: number; objects: TiledRawObject[] }
  | { type: 'group'; name: string; layers: TiledLayer[] }
  | { type: 'imagelayer'; name: string }

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

export interface Tilemap {
  /** Map size in pixels. */
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  /** Tile entities by layer name. Hidden layers get `Position` only (handy for collision layers). */
  layers: Record<string, Entity[]>
  objects: TiledObject[]
}

/** A tileset already loaded as a texture: gids from `firstgid` map to frames 0, 1, 2... */
export interface LoadedTileset {
  firstgid: number
  texture: number
}

// Tiled stores flip/rotation flags in the top four bits of each gid.
// ponytail: flips are ignored; add them as negative Sprite sizes or a flip component when maps use them
const GID_MASK = 0x0fffffff

/**
 * Spawns one entity per non-empty tile, centered in its cell, with `z = baseZ + layer index`
 * (object layers take an index too, so objects can sit between tile layers).
 * ponytail: one entity per tile; switch to chunked static meshes if maps reach hundreds of thousands of tiles
 */
export function spawnTilemap(world: World, map: TiledMap, tilesets: LoadedTileset[], { z: baseZ = 0 } = {}): Tilemap {
  if (map.orientation !== 'orthogonal') throw new Error(`Tiled: only orthogonal maps are supported, got "${map.orientation}"`)
  if (map.infinite) throw new Error('Tiled: infinite maps are not supported; disable "Infinite" in the map properties')

  const { tilewidth: tw, tileheight: th } = map
  const sorted = [...tilesets].sort((a, b) => b.firstgid - a.firstgid)
  const result: Tilemap = { width: map.width * tw, height: map.height * th, tileWidth: tw, tileHeight: th, layers: {}, objects: [] }
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
        result.objects.push({ id: o.id, name: o.name, type: o.class ?? o.type ?? '', layer: layer.name, z, x: o.x + ox, y: o.y + oy, width: o.width, height: o.height, properties })
      }
      return
    }

    if (!Array.isArray(layer.data)) throw new Error(`Tiled: layer "${layer.name}" uses ${layer.encoding} encoding; save the map with CSV layer format`)
    const entities = (result.layers[layer.name] ??= [])
    layer.data.forEach((raw, i) => {
      const gid = raw & GID_MASK
      if (!gid) return
      const tileset = sorted.find((t) => t.firstgid <= gid)
      if (!tileset) return
      const x = (i % layer.width) * tw + tw / 2 + ox
      const y = Math.floor(i / layer.width) * th + th / 2 + oy
      entities.push(
        layer.visible === false
          ? world.spawn([Position, { x, y, z }])
          : world.spawn([Position, { x, y, z }], [Sprite, { w: tw, h: th, texture: tileset.texture, frame: gid - tileset.firstgid }]),
      )
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
      const texture = await renderer.loadTexture(new URL(tileset.image, base).href, {
        frameWidth: tileset.tilewidth ?? map.tilewidth,
        frameHeight: tileset.tileheight ?? map.tileheight,
        margin: tileset.margin,
        spacing: tileset.spacing,
        filter: 'nearest',
      })
      return { firstgid: ref.firstgid, texture }
    }),
  )

  return spawnTilemap(game.world, map, tilesets, options)
}
