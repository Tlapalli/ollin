import { Camera, createCamera } from './camera'
import { Position, Rotation, Sprite } from './components'
import { token, type Plugin } from './core'
import { mat4 } from './math'

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
  /** Loads an image and returns its texture id, to be stored in `Sprite.texture`. */
  loadTexture(url: string, options?: TextureOptions): Promise<number>
  /** Loads several textures in parallel: `const t = await loadTextures({ box: boxUrl })` gives a typed `t.box`. */
  loadTextures<const M extends Record<string, TextureSource>>(manifest: M): Promise<{ [K in keyof M]: number }>
}

export const Renderer = token<Renderer>('Renderer')

const FLOATS_PER_SPRITE = 10 // x, y, z, w, h, angle, u, v, uw, vh

const VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_position;
layout(location = 2) in vec2 a_size;
layout(location = 3) in float a_angle;
layout(location = 4) in vec4 a_uv;
uniform mat4 u_viewProj;
out vec2 v_uv;
void main() {
  v_uv = a_uv.xy + a_corner * a_uv.zw;
  vec2 local = (a_corner - 0.5) * a_size;
  float c = cos(a_angle), s = sin(a_angle);
  vec2 world = a_position.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  gl_Position = u_viewProj * vec4(world, a_position.z, 1.0);
}`

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 color;
void main() { color = texture(u_texture, v_uv); }`

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
  count: number
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

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const viewProj = mat4()
    const textures: Texture[] = []
    // z → texture → batch. Higher z draws on top; same z draws in texture id order, then spawn order.
    const layers = new Map<number, Map<number, Batch>>()
    const camera = createCamera(game.canvas.width, game.canvas.height)

    const loadTexture: Renderer['loadTexture'] = async (url, options = {}) => {
      const img = new Image()
      img.src = url
      await img.decode()
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
    })

    const batchFor = (z: number, texture: number) => {
      let byTexture = layers.get(z)
      if (!byTexture) layers.set(z, (byTexture = new Map()))
      let batch = byTexture.get(texture)
      if (!batch) byTexture.set(texture, (batch = { data: new Float32Array(256 * FLOATS_PER_SPRITE), count: 0 }))
      return batch
    }

    const sprites = game.world.query(Position, Sprite)
    game.system(() => {
      // ponytail: one batch per distinct z; fine for layers, but a per-sprite y-sort (z = y) would mean one draw per sprite.
      // Add a sorted index buffer when 2.5D scenes need depth sorting inside a layer.
      for (const byTexture of layers.values()) for (const batch of byTexture.values()) batch.count = 0
      const { x, y, z } = Position
      const { w, h, texture, frame } = Sprite
      const { angle } = Rotation
      const { world } = game
      // Consecutive sprites usually share z and texture (tile layers, particles), so skip the map lookups for them.
      let batch: Batch | undefined
      let lastZ = NaN
      let lastTexture = -1
      for (const e of sprites.entities) {
        const t = textures[texture[e]]
        if (!t) continue
        if (z[e] !== lastZ || texture[e] !== lastTexture) {
          batch = batchFor(z[e], texture[e])
          lastZ = z[e]
          lastTexture = texture[e]
        }
        const b = batch!
        if ((b.count + 1) * FLOATS_PER_SPRITE > b.data.length) {
          const data = new Float32Array(b.data.length * 2)
          data.set(b.data)
          b.data = data
        }
        const col = frame[e] % t.columns
        const row = Math.floor(frame[e] / t.columns)
        const d = b.data
        const o = b.count++ * FLOATS_PER_SPRITE
        d[o] = x[e]
        d[o + 1] = y[e]
        d[o + 2] = z[e]
        d[o + 3] = w[e]
        d[o + 4] = h[e]
        d[o + 5] = world.has(e, Rotation) ? angle[e] : 0
        d[o + 6] = t.mu + col * t.su
        d[o + 7] = t.mv + row * t.sv
        d[o + 8] = t.fu
        d[o + 9] = t.fv
      }

      const { width, height } = game.canvas
      camera.width = width
      camera.height = height
      gl.viewport(0, 0, width, height)
      gl.clearColor(...background)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniformMatrix4fv(uViewProj, false, camera.viewProj(viewProj))
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, instances)
      for (const zKey of [...layers.keys()].sort((a, b) => a - b)) {
        const byTexture = layers.get(zKey)!
        for (const id of [...byTexture.keys()].sort((a, b) => a - b)) {
          const b = byTexture.get(id)!
          if (!b.count) {
            byTexture.delete(id) // drop batches for z values or textures nobody uses anymore
            continue
          }
          gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.count * FLOATS_PER_SPRITE), gl.STREAM_DRAW)
          gl.bindTexture(gl.TEXTURE_2D, textures[id].gl)
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count)
        }
        if (!byTexture.size) layers.delete(zKey)
      }
    }, 'render')
  }
