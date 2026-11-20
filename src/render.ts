import { Camera, createCamera } from './camera'
import { animation, Interpolate, Position, Rotation, Sprite } from './components'
import { token, type Game } from './core'
import { presence } from './ecs'
import { mat4, ortho } from './math'
import { DEFAULT_CHARS, type Font } from './text'

/** Options for `renderer.loadTexture`: spritesheet grid and filtering. */
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

/** Draws every entity with `Position` + `Sprite`, and loads textures and fonts: `game.get(Renderer)`. */
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
  /**
   * Fires a burst of particles: sparks, dust, pickups. They live on the GPU (the vertex shader moves and fades them),
   * so a burst costs one small upload and nothing per frame after that, however many are flying.
   */
  burst(options: BurstOptions): void
  /** Last frame's totals, for profiling (`devtools()` shows them). */
  readonly stats: { drawCalls: number; sprites: number }
}

/** Options for `renderer.burst`. */
export interface BurstOptions {
  x: number
  y: number
  /** Layer, like `Position.z`. Particles draw after the sprites of their layer. */
  z?: number
  texture: number
  frame?: number
  /** Sprite size in pixels. Default 8. */
  size?: number
  /** 0xRRGGBB; use white textures to get exactly this color. */
  tint?: number
  /** How many particles. Default 16. */
  count?: number
  /** Top speed in px/s; each particle gets 50–100% of it. Default 200. */
  speed?: number
  /** Direction in radians (0 = right, -π/2 = up) and the cone around it. Default: a full circle. */
  angle?: number
  spread?: number
  /** Seconds; each particle lives 70–100% of it and fades out. Default 0.6. */
  life?: number
  /** px/s², positive falls. Default 0. */
  gravity?: number
}

/** Options for `renderer.loadFont`. */
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

/** Options for the `webgl2()` and `webgpu()` renderer plugins. */
export interface RendererOptions {
  /** Clear color, RGBA from 0 to 1. */
  background?: [number, number, number, number]
}

/** Resource key for the `Renderer` registered by `webgl2()` or `webgpu()`. */
export const Renderer = token<Renderer>('Renderer')

/**
 * Particle layout, written once when a particle is born: x, y, vx, vy, gravity, birth time, life, size, u, v, uw, vh
 * as f32, then RGBA as 4 bytes. The vertex shader computes position and fade from the time.
 */
export const FLOATS_PER_PARTICLE = 13

/** The GPU-specific part of a renderer. Batching, sorting, assets, fonts, particles and the camera are shared. */
export interface Backend<T = unknown, P = unknown> {
  readonly name: Renderer['backend']
  /** Uploads an image with premultiplied alpha. */
  createTexture(source: HTMLImageElement | HTMLCanvasElement, filter: 'linear' | 'nearest'): T
  /** Starts a frame; `view` maps world space, `screen` canvas pixels, `time` is the particle clock in seconds. */
  begin(width: number, height: number, view: Float32Array, screen: Float32Array, time: number): void
  /** Uploads this frame's component arrays (see `SpriteData`) before any `draw`. */
  sprites(data: SpriteData): void
  /** Draws `count` sprites given by entity id. `ids` is reused right after, so upload or copy it now. */
  draw(ids: Uint32Array, count: number, texture: Texture<T>, screen: boolean): void
  /** A GPU buffer for `max` particles. */
  createParticles(max: number): P
  /** Writes particles (`FLOATS_PER_PARTICLE` floats each) starting at slot `first`. */
  writeParticles(pool: P, first: number, data: Float32Array): void
  /** Draws the first `count` slots of a pool; slots not alive at the frame's time draw nothing. */
  drawParticles(pool: P, count: number, texture: Texture<T>, screen: boolean): void
  end(): void
}

/** Particles of one (z, texture), in a ring buffer: new bursts overwrite the oldest particles when it is full. */
interface Pool {
  handle: unknown
  z: number
  texture: number
  next: number
  used: number
  /** Time the last particle dies; the pool is skipped after that. */
  until: number
}

// ponytail: fixed ring per (z, texture); grow it if games need more than this many particles alive at once per pool
const POOL_SIZE = 8192

/**
 * The component arrays the sprite shader reads by entity id, uploaded as they are each frame (no packing on the CPU).
 * `count` is the highest entity id drawn + 1. Interpolate arrays are only read when `blend >= 0`.
 * floats: Position x, y, z, Sprite w, h, Rotation angle, Sprite alpha, Interpolate x, y, angle.
 * uints: Sprite frame, tint. bytes: Sprite flipX, flipY, has Rotation, Interpolate ready, has Interpolate.
 */
export interface SpriteData {
  count: number
  blend: number
  floats: Float32Array[]
  uints: Uint32Array[]
  bytes: Uint8Array[]
}

/** A texture plus its frame grid in UV units. */
export interface Texture<T = unknown> {
  handle: T
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

/** Entity ids for one (z, texture) pair, rebuilt every frame from the ECS. */
interface Batch {
  ids: Uint32Array
  count: number
}

/** A y-sorted layer: entities collected this frame, then sorted and drawn in runs of the same texture. */
interface SortedLayer {
  ids: Uint32Array
  count: number
  /** Last frame's sorted entities. The sort is stable and starts from this order, so ties never flicker. */
  order: Uint32Array
  sorted: number
}

// Radix sort digits: 11 bits per pass, so a layer spanning 128 screens of height (at 1/16 px) still takes 2 passes.
const RADIX_BITS = 11
const RADIX_MASK = (1 << RADIX_BITS) - 1

const grow = <T extends Float32Array | Uint32Array | Float64Array>(a: T, needed: number): T => {
  if (needed <= a.length) return a
  const next = new (a.constructor as new (n: number) => T)(Math.max(needed, a.length * 2))
  next.set(a as never)
  return next
}

const newBatch = (): Batch => ({ ids: new Uint32Array(256), count: 0 })

interface Snapshot {
  z: Int32Array
  texture: Int32Array
}

/** Whether `z` and `texture` of entities below `top` still hold the snapshot's bits. */
function same(z: Float32Array, texture: Uint32Array, top: number, snap: Snapshot) {
  if (snap.z.length !== top) return false
  const zi = new Int32Array(z.buffer, z.byteOffset, top)
  const ti = new Int32Array(texture.buffer, texture.byteOffset, top)
  const sz = snap.z
  const st = snap.texture
  for (let i = 0; i < top; i++) if (zi[i] !== sz[i] || ti[i] !== st[i]) return false
  return true
}

function snapshot(z: Float32Array, texture: Uint32Array, top: number, snap: Snapshot) {
  snap.z = new Int32Array(z.buffer.slice(z.byteOffset, z.byteOffset + top * 4))
  snap.texture = new Int32Array(texture.buffer.slice(texture.byteOffset, texture.byteOffset + top * 4))
}

/**
 * Appends each sprite's id to the batch (or sorted layer) of its (z, texture) and returns the highest id + 1.
 * Consecutive sprites usually share both (tile layers, particles), so `pick` (the map lookups) runs only when they
 * change. Top-level and small so V8 optimizes it on its own.
 */
function collect(all: readonly number[], z: Float32Array, texture: Uint32Array, pick: (z: number, texture: number) => Batch | undefined) {
  const n = all.length
  let top = 0
  let list: Batch | undefined
  let ids: Uint32Array = new Uint32Array(0)
  let count = 0
  let lastZ = NaN
  let lastTexture = -1
  for (let i = 0; i < n; i++) {
    const e = all[i]
    if (z[e] !== lastZ || texture[e] !== lastTexture) {
      if (list) list.count = count
      lastZ = z[e]
      lastTexture = texture[e]
      list = pick(lastZ, lastTexture)
      if (list) ({ ids, count } = list)
    }
    if (!list) continue
    if (count === ids.length) ids = list.ids = grow(ids, count + 1)
    ids[count++] = e
    if (e >= top) top = e + 1
  }
  if (list) list.count = count
  return top
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
  // Particle clock: game time, so particles pause with the game.
  // ponytail: f32 birth times lose precision after hours of play (~2 ms at 4.5 h); rebase the clock if sessions run that long
  let time = 0
  const pools = new Map<string, Pool>()
  let particleData = new Float32Array(64 * FLOATS_PER_PARTICLE)

  const burst = ({ x, y, z = 0, texture, frame = 0, size = 8, tint = 0xffffff, count = 16, speed = 200, angle = 0, spread = Math.PI * 2, life = 0.6, gravity = 0 }: BurstOptions) => {
    const t = textures[texture]
    if (!t) return
    const key = `${z} ${texture}`
    let pool = pools.get(key)
    if (!pool) pools.set(key, (pool = { handle: backend.createParticles(POOL_SIZE), z, texture, next: 0, used: 0, until: 0 }))
    count = Math.min(count, POOL_SIZE)
    particleData = grow(particleData, count * FLOATS_PER_PARTICLE)
    const d = particleData
    const bits = new Uint32Array(d.buffer)
    const u = t.mu + (frame % t.columns) * t.su
    const v = t.mv + Math.floor(frame / t.columns) * t.sv
    const rgba = (255 << 24) | ((tint & 0xff) << 16) | (tint & 0xff00) | ((tint >> 16) & 0xff)
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread
      const s = speed * (0.5 + Math.random() * 0.5)
      const o = i * FLOATS_PER_PARTICLE
      d[o] = x
      d[o + 1] = y
      d[o + 2] = Math.cos(a) * s
      d[o + 3] = Math.sin(a) * s
      d[o + 4] = gravity
      d[o + 5] = time
      d[o + 6] = life * (0.7 + Math.random() * 0.3)
      d[o + 7] = size
      d[o + 8] = u
      d[o + 9] = v
      d[o + 10] = t.fu
      d[o + 11] = t.fv
      bits[o + 12] = rgba
    }
    // Ring buffer: write up to the end, then wrap to the start.
    const first = pool.next
    const head = Math.min(count, POOL_SIZE - first)
    backend.writeParticles(pool.handle, first, d.subarray(0, head * FLOATS_PER_PARTICLE))
    if (head < count) backend.writeParticles(pool.handle, 0, d.subarray(head * FLOATS_PER_PARTICLE, count * FLOATS_PER_PARTICLE))
    pool.next = (first + count) % POOL_SIZE
    pool.used = Math.min(POOL_SIZE, pool.used + count)
    pool.until = Math.max(pool.until, time + life)
  }

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

  // Texture 0 is one white pixel, so a Sprite without a texture is a solid rectangle in its tint: panels, bars, fades.
  const white = globalThis.document?.createElement('canvas') ?? ({ width: 1, height: 1 } as HTMLCanvasElement)
  white.width = white.height = 1
  const ctx = white.getContext?.('2d')
  if (ctx) (ctx.fillStyle = '#fff'), ctx.fillRect(0, 0, 1, 1)
  createTexture(white, {})

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
    burst,
    loadFont(options = {}) {
      const key = `font ${JSON.stringify(options)}`
      let font = fonts.get(key)
      if (!font) fonts.set(key, (font = renderFont(options)))
      return font
    },
  })

  const sortedFor = (z: number) => {
    let layer = sortedLayers.get(z)
    if (!layer) sortedLayers.set(z, (layer = { ids: new Uint32Array(256), count: 0, order: new Uint32Array(256), sorted: 0 }))
    return layer
  }

  const pick = (z: number, texture: number): Batch | undefined =>
    !textures[texture] ? undefined : ySort.has(z) ? sortedFor(z) : batchFor(z, texture)

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

  // Interpolation: record each Interpolate entity's transform at the start of every fixed tick (the renderer's plugin
  // runs before the game's, so this sees the state the last tick left).
  const interpolated = world.query(Interpolate, Position)
  world.query(Rotation) // registers Rotation, so its arrays exist for the upload even if no entity has used it yet
  game.system(() => {
    const { x, y, angle: a, ready } = Interpolate
    for (const e of interpolated.entities) {
      x[e] = Position.x[e]
      y[e] = Position.y[e]
      a[e] = world.has(e, Rotation) ? Rotation.angle[e] : 0
      ready[e] = 1
    }
  }, 'fixed')

  /** Highest entity id drawn this frame + 1. */
  let top = 0
  /** What the current batches were built from. */
  const built = { version: -1, textures: 0, sorting: '', z: new Int32Array(0), texture: new Int32Array(0) }

  /** Appends one sprite to a batch. */
  const pack = (b: Batch, e: number) => {
    if (b.count === b.ids.length) b.ids = grow(b.ids, b.count + 1)
    b.ids[b.count++] = e
  }

  let onScreen = false
  const draw = (b: Batch, texture: number) => {
    backend.draw(b.ids, b.count, textures[texture], onScreen)
    stats.drawCalls++
    stats.sprites += b.count
  }

  // Per-entity frame stamps: `inLayer[e] === frame` means e was collected this frame, `placed[e] === frame` that it is queued.
  let frame = 0
  let inLayer = new Uint32Array(1024)
  let placed = new Uint32Array(1024)
  // Sort scratch, shared by every sorted layer: entities and keys, twice for the radix passes.
  let items = new Uint32Array(256)
  let keys = new Uint32Array(256)
  let itemsOut = new Uint32Array(256)
  let keysOut = new Uint32Array(256)
  const buckets = new Uint32Array(1 << RADIX_BITS)

  const drawSorted = (layer: SortedLayer) => {
    const { y } = Position
    const { h, texture } = Sprite
    const n = layer.count
    frame++
    for (let i = 0; i < n; i++) {
      const e = layer.ids[i]
      if (e >= inLayer.length) {
        inLayer = grow(inLayer, e + 1)
        placed = grow(placed, e + 1)
      }
      inLayer[e] = frame
    }
    items = grow(items, n)
    keys = grow(keys, n)
    itemsOut = grow(itemsOut, n)
    keysOut = grow(keysOut, n)
    // Input order: last frame's order for sprites still here, then new ones.
    let k = 0
    for (let i = 0; i < layer.sorted; i++) {
      const e = layer.order[i]
      if (inLayer[e] === frame && placed[e] !== frame) {
        placed[e] = frame
        items[k++] = e
      }
    }
    for (let i = 0; i < n; i++) {
      const e = layer.ids[i]
      if (placed[e] !== frame) {
        placed[e] = frame
        items[k++] = e
      }
    }
    // Keys: bottom edge in 1/16 px, shifted so the smallest is 0.
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < n; i++) {
      const e = items[i]
      const q = Math.round((y[e] + h[e] / 2) * 16)
      keysOut[i] = q // stored mod 2^32, so negatives wrap...
      if (q < min) min = q
      if (q > max) max = q
    }
    for (let i = 0; i < n; i++) keys[i] = (keysOut[i] - min) >>> 0 // ...and come back right once shifted by min
    const range = Math.min(max - min, 0xffffffff)
    // Stable LSD radix sort on the keys: O(n) per pass, ties keep the input order.
    for (let shift = 0; shift < 32 && (shift === 0 || range >>> shift); shift += RADIX_BITS) {
      buckets.fill(0)
      for (let i = 0; i < n; i++) buckets[(keys[i] >>> shift) & RADIX_MASK]++
      for (let b = 0, sum = 0; b < buckets.length; b++) {
        const c = buckets[b]
        buckets[b] = sum
        sum += c
      }
      for (let i = 0; i < n; i++) {
        const at = buckets[(keys[i] >>> shift) & RADIX_MASK]++
        itemsOut[at] = items[i]
        keysOut[at] = keys[i]
      }
      ;[items, itemsOut] = [itemsOut, items]
      ;[keys, keysOut] = [keysOut, keys]
    }
    layer.order = grow(layer.order, n)
    layer.order.set(items.subarray(0, n))
    layer.sorted = n
    // Emit runs of consecutive sprites that share a texture; each run is one draw call.
    let runTexture = -1
    for (let i = 0; i < n; i++) {
      const e = items[i]
      if (texture[e] !== runTexture && scratch.count) {
        draw(scratch, runTexture)
        scratch.count = 0
      }
      runTexture = texture[e]
      pack(scratch, e)
    }
    if (scratch.count) draw(scratch, runTexture)
    scratch.count = 0
  }

  game.system((dt) => {
    time += dt
    stats.drawCalls = stats.sprites = 0
    const { z } = Position
    const { texture } = Sprite
    // Batches only change when sprites come or go or a z or texture changes; otherwise last frame's ids still hold.
    const sorting = [...ySort].join()
    if (sprites.version !== built.version || textures.length !== built.textures || sorting !== built.sorting || !same(z, texture, top, built)) {
      for (const byTexture of layers.values()) for (const batch of byTexture.values()) batch.count = 0
      for (const layer of sortedLayers.values()) layer.count = 0
      top = collect(sprites.entities, z, texture, pick)
      snapshot(z, texture, top, built)
      built.version = sprites.version
      built.textures = textures.length
      built.sorting = sorting
    }

    const { width, height } = game.canvas
    camera.width = width
    camera.height = height
    camera.viewProj(viewProj)
    ortho(screenProj, 0, width, height, 0, -1000, 1000)
    backend.begin(width, height, viewProj, screenProj, time)
    backend.sprites({
      count: top,
      blend: interpolated.entities.length ? game.fixedAlpha : -1,
      floats: [Position.x, Position.y, Position.z, Sprite.w, Sprite.h, Rotation.angle, Sprite.alpha, Interpolate.x, Interpolate.y, Interpolate.angle],
      uints: [Sprite.frame, Sprite.tint],
      bytes: [Sprite.flipX, Sprite.flipY, presence(Rotation), Interpolate.ready, presence(Interpolate)],
    })
    const live = [...pools.values()].filter((p) => p.until > time)
    for (const zKey of [...new Set([...layers.keys(), ...sortedLayers.keys(), ...live.map((p) => p.z)])].sort((a, b) => a - b)) {
      onScreen = screen.has(zKey)
      const layer = sortedLayers.get(zKey)
      if (layer) {
        if (layer.count) drawSorted(layer)
        else sortedLayers.delete(zKey)
      }
      const byTexture = layers.get(zKey)
      if (byTexture) {
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
      for (const pool of live) {
        if (pool.z !== zKey) continue
        backend.drawParticles(pool.handle, pool.used, textures[pool.texture], onScreen)
        stats.drawCalls++
      }
    }
    backend.end()
  }, 'render')
}
