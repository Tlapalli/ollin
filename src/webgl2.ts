import { Camera, createCamera } from './camera'
import { animation, particles, Position, Rotation, Sprite } from './components'
import { token, type Plugin } from './core'
import { mat4, ortho } from './math'
import type { Font } from './text'

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
  gl: WebGL2RenderingContext
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
   * Renders the printable ASCII characters of a font (a CSS family, including web fonts) into a texture,
   * for `spawnText`. Glyphs are white so `Sprite.tint` colors them. Cached by options.
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
}

export const Renderer = token<Renderer>('Renderer')

const FLOATS_PER_SPRITE = 11 // x, y, z, w, h, angle, u, v, uw, vh, then RGBA as 4 bytes

const VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_position;
layout(location = 2) in vec2 a_size;
layout(location = 3) in float a_angle;
layout(location = 4) in vec4 a_uv;
layout(location = 5) in vec4 a_tint;
uniform mat4 u_viewProj;
out vec2 v_uv;
out vec4 v_tint;
void main() {
  v_uv = a_uv.xy + a_corner * a_uv.zw;
  v_tint = a_tint;
  vec2 local = (a_corner - 0.5) * a_size;
  float c = cos(a_angle), s = sin(a_angle);
  vec2 world = a_position.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  gl_Position = u_viewProj * vec4(world, a_position.z, 1.0);
}`

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_tint;
out vec4 color;
// Textures are premultiplied, so alpha scales every channel.
void main() { color = texture(u_texture, v_uv) * vec4(v_tint.rgb, 1.0) * v_tint.a; }`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
  return shader
}

/** A texture plus its frame grid in UV units. */
interface Texture {
  gl: WebGLTexture
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

export const webgl2 = ({ background = [0.1, 0.1, 0.1, 1] as [number, number, number, number] } = {}): Plugin =>
  (game) => {
    const gl = game.canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true })
    if (!gl) throw new Error('WebGL2 is not available in this browser')

    const program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
    const uViewProj = gl.getUniformLocation(program, 'u_viewProj')

    // One shared quad (TRIANGLE_STRIP) + one interleaved, instanced buffer.
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const instances = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, instances)
    const stride = FLOATS_PER_SPRITE * 4
    const attributes: [location: number, size: number, offset: number][] = [
      [1, 3, 0],
      [2, 2, 12],
      [3, 1, 20],
      [4, 4, 24],
    ]
    for (const [location, size, offset] of attributes) {
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset)
      gl.vertexAttribDivisor(location, 1)
    }
    gl.enableVertexAttribArray(5)
    gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, stride, 40)
    gl.vertexAttribDivisor(5, 1)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
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
      const texture = gl.createTexture()
      const filter = options.filter === 'nearest' ? gl.NEAREST : gl.LINEAR
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const { width, height } = img
      const { frameWidth = width, frameHeight = height, margin = 0, spacing = 0 } = options
      return textures.push({
        gl: texture,
        columns: Math.max(1, Math.floor((width - 2 * margin + spacing) / (frameWidth + spacing))),
        fu: frameWidth / width,
        fv: frameHeight / height,
        su: (frameWidth + spacing) / width,
        sv: (frameHeight + spacing) / height,
        mu: margin / width,
        mv: margin / height,
      }) - 1
    }

    game.set(Camera, camera)
    game.set(Renderer, {
      gl,
      loadTexture,
      async loadTextures(manifest) {
        const entries = Object.entries(manifest as Record<string, TextureSource>)
        const ids = await Promise.all(
          entries.map(([, source]) => (typeof source === 'string' ? loadTexture(source) : loadTexture(...source))),
        )
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

    const fonts = new Map<string, Promise<Font>>()
    const renderFont = async ({ family = 'monospace', size = 32, weight = 'normal', filter }: FontOptions): Promise<Font> => {
      const css = `${weight} ${size}px ${family}`
      await document.fonts.load(css)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      ctx.font = css
      const chars = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
      const advances = chars.map((c) => ctx.measureText(c).width)
      // One padded cell per glyph, 16 per row, so the font is an ordinary spritesheet.
      const cellWidth = Math.ceil(Math.max(...advances)) + 2
      const cellHeight = Math.ceil(size * 1.3) + 2
      canvas.width = cellWidth * 16
      canvas.height = cellHeight * 6
      ctx.font = css // resizing the canvas resets the context
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'top'
      chars.forEach((c, i) => ctx.fillText(c, (i % 16) * cellWidth + 1, Math.floor(i / 16) * cellHeight + 1))
      const texture = createTexture(canvas, { frameWidth: cellWidth, frameHeight: cellHeight, filter })
      return { texture, size, cellWidth, cellHeight, lineHeight: Math.ceil(size * 1.2), advances }
    }

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

    const sprites = game.world.query(Position, Sprite)
    game.system(animation(game.world))
    game.system(particles(game.world))

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

    const draw = (b: Batch, texture: number) => {
      gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.count * FLOATS_PER_SPRITE), gl.STREAM_DRAW)
      gl.bindTexture(gl.TEXTURE_2D, textures[texture].gl)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count)
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

    const { world } = game
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
      gl.viewport(0, 0, width, height)
      gl.clearColor(...background)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      camera.viewProj(viewProj)
      ortho(screenProj, 0, width, height, 0, -1000, 1000)
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, instances)
      let proj: Float32Array | undefined
      for (const zKey of [...new Set([...layers.keys(), ...sortedLayers.keys()])].sort((a, b) => a - b)) {
        const want = screen.has(zKey) ? screenProj : viewProj
        if (want !== proj) gl.uniformMatrix4fv(uViewProj, false, (proj = want))
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
    }, 'render')
  }
