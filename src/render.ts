import { Camera, createCamera } from './camera'
import { animation, particles, Position, Rotation, Sprite } from './components'
import { token, type Game } from './core'
import { mat4, ortho } from './math'
import { DEFAULT_CHARS, type Font } from './text'

export interface TextureOptions {
  /** Frame size in pixels for spritesheets and tilesets; `Sprite.frame` picks a cell, row by row. Default: whole image. */
  frameWidth?: number
  frameHeight?: number
  /** Pixels around the whole grid (Tiled `margin`). */
  margin?: number
  /** Pixels between cells (Tiled `spacing`). */
  spacing?: number
  /** `nearest` keeps pixel art and tiles crisp. Default `linear`. */
  filter?: 'linear' | 'nearest'
}

type TextureSource = string | readonly [url: string, options: TextureOptions]

export interface Renderer {
  /** The GPU API in use; `webgpu()` falls back to `webgl2` where WebGPU is not available. */
  readonly backend: 'webgl2' | 'webgpu'
  /** Loads an image and returns its texture id, to be stored in `Sprite.texture`. Cached by URL and options, so restarting a scene reuses it. */
  loadTexture(url: string, options?: TextureOptions): Promise<number>
  /** Loads several textures in parallel: `const t = await loadTextures({ box: boxUrl })` gives a typed `t.box`. */
  loadTextures<const M extends Record<string, TextureSource>>(manifest: M): Promise<{ [K in keyof M]: number }>
  /**
   * z layers drawn in order of each sprite's bottom edge (`y + h / 2`) instead of batched by texture, so
   * things lower on screen cover things behind them (2.5D, isometric). Ties keep spawn order.
   * `renderer.ySort.add(1)`. Sprites in a sorted layer that share one texture still draw in a single call.
   */
  ySort: Set<number>
  /**
   * z layers drawn in canvas pixels, ignoring the camera: HUD, score, menus. (0, 0) is the top-left corner.
   * `renderer.screen.add(100)`.
   */
  screen: Set<number>
  /**
   * Renders a font (a CSS family, including web fonts) into a texture for `spawnText`: ASCII, accented Latin letters,
   * ñ, ¿, ¡ and Nahuatl macron vowels, plus `chars`. Glyphs are white so tint colors them. Cached by options.
   */
  loadFont(options?: FontOptions): Promise<Font>
  /** Last frame's totals, for profiling (`devtools()` shows them). */
  readonly stats: { drawCalls: number; sprites: number }
}

export interface FontOptions {
  /** CSS font family. Default `monospace`. */
  family?: string
  /** Size in pixels the glyphs are rendered at; `spawnText` scales from it. Default 32. */
  size?: number
  /** CSS font weight. Default `normal`. */
  weight?: string
  /** `nearest` for pixel fonts. Default `linear`. */
  filter?: 'linear' | 'nearest'
  /** Extra characters beyond `DEFAULT_CHARS`, e.g. `'←→♥★'`. */
  chars?: string
}

export interface RendererOptions {
  /** Clear color, RGBA from 0 to 1. */
  background?: [number, number, number, number]
}

export const Renderer = token<Renderer>('Renderer')

/** Instance layout every backend reads: x, y, z, w, h, angle, u, v, uw, vh as f32, then RGBA as 4 bytes. */
export const FLOATS_PER_SPRITE = 11

/** The GPU-specific part of a renderer. Batching, sorting, assets, fonts and the camera are shared. */
export interface Backend<T = unknown> {
  readonly name: Renderer['backend']
  /** Uploads an image with premultiplied alpha. */
  createTexture(source: HTMLImageElement | HTMLCanvasElement, filter: 'linear' | 'nearest'): T
  /** Starts a frame; `view` maps world space, `screen` canvas pixels. */
  begin(width: number, height: number, view: Float32Array, screen: Float32Array): void
  /** Draws `count` sprites (`FLOATS_PER_SPRITE` floats each). `data` is reused right after, so upload or copy it now. */
  draw(data: Float32Array, count: number, texture: T, screen: boolean): void
  end(): void
}

/** A texture plus its frame grid in UV units. */
interface Texture {
  handle: unknown
  columns: number
  /** Frame size. */
  fu: number
  fv: number
  /** Distance from one frame to the next (frame + spacing). */
  su: number
  sv: number
  /** Grid margin. */
  mu: number
  mv: number
}

/** Packed instance data for one (z, texture) pair, rebuilt every frame from the ECS. */
interface Batch {
  data: Float32Array
  /** Same memory as `data`, for the packed RGBA word. */
  bits: Uint32Array
  count: number
}

/** A y-sorted layer: entities collected this frame, then sorted and drawn in runs of the same texture. */
interface SortedLayer {
  entities: Uint32Array
  count: number
  /** Last frame's sorted keys. Rebuilding keys in that order hands the sort nearly sorted input. */
  keys: Float64Array
  sorted: number
}

// Sort keys pack (bottom y in 1/16 px, entity) into one float64 so a native numeric sort orders them.
// Exact while |y| < 2^27 px and entity ids < 2^21.
const ENTITY_BITS = 2 ** 21

const grow = <T extends Float32Array | Uint32Array | Float64Array>(a: T, needed: number): T => {
  if (needed <= a.length) return a
  const next = new (a.constructor as new (n: number) => T)(Math.max(needed, a.length * 2))
  next.set(a as never)
  return next
}

const newBatch = (): Batch => {
  const data = new Float32Array(256 * FLOATS_PER_SPRITE)
  return { data, bits: new Uint32Array(data.buffer), count: 0 }
}

/** Registers the `Renderer` and `Camera` resources and the render system on top of a backend. */
export function createRenderer(game: Game, backend: Backend) {
  const viewProj = mat4()
  const screenProj = mat4()
  const textures: Texture[] = []
  // z → texture → batch. Higher z draws on top; same z draws in texture id order, then spawn order.
  const layers = new Map<number, Map<number, Batch>>()
  const sortedLayers = new Map<number, SortedLayer>()
  const ySort = new Set<number>()
  const screen = new Set<number>()
  const scratch = newBatch()
  const stats = { drawCalls: 0, sprites: 0 }
  const camera = createCamera(game.canvas.width, game.canvas.height)

  const cache = new Map<string, Promise<number>>()
  const loadTexture: Renderer['loadTexture'] = (url, options = {}) => {
    const key = `${url} ${JSON.stringify(options)}`
    let id = cache.get(key)
    if (!id) cache.set(key, (id = upload(url, options)))
    id.catch(() => cache.delete(key)) // a failed load can be retried
    return id
  }

  const upload = async (url: string, options: TextureOptions) => {
    const img = new Image()
    img.src = url
    await img.decode()
    return createTexture(img, options)
  }

  const createTexture = (img: HTMLImageElement | HTMLCanvasElement, options: TextureOptions) => {
    const { width, height } = img
    const { frameWidth = width, frameHeight = height, margin = 0, spacing = 0 } = options
    return (
      textures.push({
        handle: backend.createTexture(img, options.filter ?? 'linear'),
        columns: Math.max(1, Math.floor((width - 2 * margin + spacing) / (frameWidth + spacing))),
        fu: frameWidth / width,
        fv: frameHeight / height,
        su: (frameWidth + spacing) / width,
        sv: (frameHeight + spacing) / height,
        mu: margin / width,
        mv: margin / height,
      }) - 1
    )
  }

  const fonts = new Map<string, Promise<Font>>()
  const renderFont = async ({ family = 'monospace', size = 32, weight = 'normal', filter, chars: extra = '' }: FontOptions): Promise<Font> => {
    const css = `${weight} ${size}px ${family}`
    await document.fonts.load(css)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = css
    const chars = [...new Set(DEFAULT_CHARS + extra.normalize('NFC'))]
    const advances = chars.map((c) => ctx.measureText(c).width)
    // One padded cell per glyph, 16 per row, so the font is an ordinary spritesheet.
    const cellWidth = Math.ceil(Math.max(...advances)) + 2
    const cellHeight = Math.ceil(size * 1.3) + 2
    canvas.width = cellWidth * 16
    canvas.height = cellHeight * Math.ceil(chars.length / 16)
    ctx.font = css // resizing the canvas resets the context
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    chars.forEach((c, i) => ctx.fillText(c, (i % 16) * cellWidth + 1, Math.floor(i / 16) * cellHeight + 1))
    const texture = createTexture(canvas, { frameWidth: cellWidth, frameHeight: cellHeight, filter })
    return { texture, size, cellWidth, cellHeight, lineHeight: Math.ceil(size * 1.2), glyphs: new Map(chars.map((c, i) => [c, i])), advances }
  }

  game.set(Camera, camera)
  game.set(Renderer, {
    backend: backend.name,
    loadTexture,
    async loadTextures(manifest) {
      const entries = Object.entries(manifest as Record<string, TextureSource>)
      const ids = await Promise.all(entries.map(([, source]) => (typeof source === 'string' ? loadTexture(source) : loadTexture(...source))))
      return Object.fromEntries(entries.map(([key], i) => [key, ids[i]])) as never
    },
    ySort,
    screen,
    stats,
    loadFont(options = {}) {
      const key = `font ${JSON.stringify(options)}`
      let font = fonts.get(key)
      if (!font) fonts.set(key, (font = renderFont(options)))
      return font
    },
  })

  const sortedFor = (z: number) => {
    let layer = sortedLayers.get(z)
    if (!layer) sortedLayers.set(z, (layer = { entities: new Uint32Array(256), count: 0, keys: new Float64Array(256), sorted: 0 }))
    return layer
  }

  const batchFor = (z: number, texture: number) => {
    let byTexture = layers.get(z)
    if (!byTexture) layers.set(z, (byTexture = new Map()))
    let batch = byTexture.get(texture)
    if (!batch) byTexture.set(texture, (batch = newBatch()))
    return batch
  }

  const { world } = game
  const sprites = world.query(Position, Sprite)
  game.system(animation(world))
  game.system(particles(world))

  // Component arrays, read once per frame at the top of the render system (they are replaced when the world grows).
  let px = Position.x, py = Position.y, pz = Position.z, angle = Rotation.angle
  let sw = Sprite.w, sh = Sprite.h, sframe = Sprite.frame, stint = Sprite.tint, salpha = Sprite.alpha, sflipX = Sprite.flipX, sflipY = Sprite.flipY

  /** Appends one sprite's instance data to a batch. */
  const pack = (b: Batch, e: number, t: Texture) => {
    if ((b.count + 1) * FLOATS_PER_SPRITE > b.data.length) {
      b.data = grow(b.data, (b.count + 1) * FLOATS_PER_SPRITE)
      b.bits = new Uint32Array(b.data.buffer)
    }
    const o = b.count++ * FLOATS_PER_SPRITE
    const d = b.data
    const f = sframe[e]
    const col = f % t.columns
    const row = Math.floor(f / t.columns)
    const u = t.mu + col * t.su
    const v = t.mv + row * t.sv
    const flipX = sflipX[e]
    const flipY = sflipY[e]
    d[o] = px[e]
    d[o + 1] = py[e]
    d[o + 2] = pz[e]
    d[o + 3] = sw[e]
    d[o + 4] = sh[e]
    d[o + 5] = world.has(e, Rotation) ? angle[e] : 0
    // Mirroring is free: start from the far edge of the frame and walk the UVs backwards.
    d[o + 6] = flipX ? u + t.fu : u
    d[o + 7] = flipY ? v + t.fv : v
    d[o + 8] = flipX ? -t.fu : t.fu
    d[o + 9] = flipY ? -t.fv : t.fv
    const a = salpha[e]
    const tint = stint[e]
    // Little-endian RGBA bytes, read by the shader as a normalized vec4.
    b.bits[o + 10] = ((a >= 1 ? 255 : a <= 0 ? 0 : (a * 255 + 0.5) | 0) << 24) | ((tint & 0xff) << 16) | (tint & 0xff00) | ((tint >> 16) & 0xff)
  }

  let onScreen = false
  const draw = (b: Batch, texture: number) => {
    backend.draw(b.data, b.count, textures[texture].handle, onScreen)
    stats.drawCalls++
    stats.sprites += b.count
    b.count = 0
  }

  // Per-entity frame stamps: `inLayer[e] === frame` means e was collected this frame, `placed[e] === frame` that it has a key.
  let frame = 0
  let inLayer = new Uint32Array(1024)
  let placed = new Uint32Array(1024)
  let spare: Float64Array = new Float64Array(256) // swapped with a layer's keys each frame

  const drawSorted = (layer: SortedLayer) => {
    const { y } = Position
    const { h, texture } = Sprite
    const n = layer.count
    frame++
    for (let i = 0; i < n; i++) {
      const e = layer.entities[i]
      if (e >= inLayer.length) {
        inLayer = grow(inLayer, e + 1)
        placed = grow(placed, e + 1)
      }
      inLayer[e] = frame
    }
    const previous = layer.keys.subarray(0, layer.sorted)
    const keys = (spare = grow(spare, n))
    let k = 0
    const add = (e: number) => {
      placed[e] = frame
      keys[k++] = Math.round((y[e] + h[e] / 2) * 16) * ENTITY_BITS + e
    }
    for (const key of previous) {
      const e = key - Math.floor(key / ENTITY_BITS) * ENTITY_BITS
      if (inLayer[e] === frame && placed[e] !== frame) add(e)
    }
    for (let i = 0; i < n; i++) if (placed[layer.entities[i]] !== frame) add(layer.entities[i])
    spare = layer.keys
    layer.keys = keys
    layer.sorted = n
    // ponytail: comparison sort, ~1 ms for 20k sprites that all reshuffle every frame (worst case); scenes where
    // most sprites stay put hand it nearly sorted keys and cost ~0.05 ms. Switch to a radix sort on y if crowds get dense.
    keys.subarray(0, n).sort()
    // Emit runs of consecutive sprites that share a texture; each run is one draw call.
    let runTexture = -1
    for (let i = 0; i < n; i++) {
      const e = keys[i] - Math.floor(keys[i] / ENTITY_BITS) * ENTITY_BITS
      if (texture[e] !== runTexture && scratch.count) draw(scratch, runTexture)
      runTexture = texture[e]
      pack(scratch, e, textures[runTexture])
    }
    if (scratch.count) draw(scratch, runTexture)
  }

  game.system(() => {
    ;({ x: px, y: py, z: pz } = Position)
    angle = Rotation.angle
    ;({ w: sw, h: sh, frame: sframe, tint: stint, alpha: salpha, flipX: sflipX, flipY: sflipY } = Sprite)
    for (const byTexture of layers.values()) for (const batch of byTexture.values()) batch.count = 0
    for (const layer of sortedLayers.values()) layer.count = 0
    stats.drawCalls = stats.sprites = 0
    const { z } = Position
    const { texture } = Sprite
    // Consecutive sprites usually share z and texture (tile layers, particles), so skip the map lookups for them.
    let batch: Batch | undefined
    let sorted: SortedLayer | undefined
    let lastZ = NaN
    let lastTexture = -1
    for (const e of sprites.entities) {
      const t = textures[texture[e]]
      if (!t) continue
      if (z[e] !== lastZ || texture[e] !== lastTexture) {
        lastZ = z[e]
        lastTexture = texture[e]
        sorted = ySort.has(lastZ) ? sortedFor(lastZ) : undefined
        batch = sorted ? undefined : batchFor(lastZ, lastTexture)
      }
      if (sorted) {
        sorted.entities = grow(sorted.entities, sorted.count + 1)
        sorted.entities[sorted.count++] = e
        continue
      }
      pack(batch!, e, t)
    }

    const { width, height } = game.canvas
    camera.width = width
    camera.height = height
    camera.viewProj(viewProj)
    ortho(screenProj, 0, width, height, 0, -1000, 1000)
    backend.begin(width, height, viewProj, screenProj)
    for (const zKey of [...new Set([...layers.keys(), ...sortedLayers.keys()])].sort((a, b) => a - b)) {
      onScreen = screen.has(zKey)
      const layer = sortedLayers.get(zKey)
      if (layer) {
        if (layer.count) drawSorted(layer)
        else sortedLayers.delete(zKey)
      }
      const byTexture = layers.get(zKey)
      if (!byTexture) continue
      for (const id of [...byTexture.keys()].sort((a, b) => a - b)) {
        const b = byTexture.get(id)!
        if (!b.count) {
          byTexture.delete(id) // drop batches for z values or textures nobody uses anymore
          continue
        }
        draw(b, id)
      }
      if (!byTexture.size) layers.delete(zKey)
    }
    backend.end()
  }, 'render')
}
