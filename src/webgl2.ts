import type { Plugin } from './core'
import { createRenderer, FLOATS_PER_PARTICLE, type Backend, type RendererOptions } from './render'

// Sprites arrive as entity ids; the shader reads their components straight from the ECS arrays, uploaded as they are
// into texture array layers (1024 entities per row, one layer per field; see SpriteData for the order).
const VERT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp usampler2DArray;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in uint a_entity;
uniform mat4 u_viewProj;
uniform sampler2DArray u_floats;
uniform usampler2DArray u_uints;
uniform usampler2DArray u_bytes;
uniform float u_blend;
uniform vec4 u_cell; // frame size u, v; step u, v
uniform vec4 u_grid; // margin u, v; columns; first atlas texel, or -1 for a grid
uniform highp sampler2D u_frames; // atlas frame table, 2 texels per frame (see Backend.frames)
uniform vec2 u_texSize; // image size in pixels
out vec2 v_uv;
out vec4 v_tint;
// Tiling and NineSlice pick their UVs per pixel, in the fragment shader (see SPRITE_FRAG).
out vec2 v_local;
flat out vec4 v_rect;
flat out vec4 v_params;
flat out vec4 v_size;
flat out int v_mode;
ivec2 at;
float F(int layer) { return texelFetch(u_floats, ivec3(at, layer), 0).r; }
uint U(int layer) { return texelFetch(u_uints, ivec3(at, layer), 0).r; }
uint B(int layer) { return texelFetch(u_bytes, ivec3(at, layer), 0).r; }
vec4 frameTexel(int i) { return texelFetch(u_frames, ivec2(i & 1023, i >> 10), 0); }
void main() {
  at = ivec2(int(a_entity & 1023u), int(a_entity >> 10u));
  vec3 position = vec3(F(0), F(1), F(2));
  float angle = B(2) == 1u ? F(5) : 0.0;
  if (u_blend >= 0.0 && B(3) != 0u && B(4) == 1u) {
    position.xy = mix(vec2(F(7), F(8)), position.xy, u_blend);
    float turn = angle - F(9);
    angle = F(9) + (turn - 6.2831853 * round(turn / 6.2831853)) * u_blend; // shortest way around
  }
  uint frame = U(0);
  vec2 uv;
  vec2 cell;
  vec4 trim = vec4(0.0, 0.0, 1.0, 1.0); // where the frame's pixels sit inside the sprite
  if (u_grid.w >= 0.0) {
    int i = int(u_grid.w) + int(frame) * 2;
    vec4 r = frameTexel(i);
    uv = r.xy;
    cell = r.zw;
    trim = frameTexel(i + 1);
  } else {
    uint columns = uint(u_grid.z);
    uv = u_grid.xy + vec2(float(frame % columns), float(frame / columns)) * u_cell.zw;
    cell = u_cell.xy;
  }
  v_uv = uv + a_corner * cell;
  vec2 size = vec2(F(3), F(4));
  v_mode = B(5) == 1u ? 1 : B(6) == 1u ? 2 : 0;
  if (v_mode != 0) {
    vec2 source = cell * u_texSize; // the frame's size in image pixels
    v_rect = vec4(uv, cell);
    v_size = vec4(size, source);
    v_local = a_corner * size;
    // Tiling: a repetition is w x h pixels (0 = the frame's size), shifted by x, y. NineSlice: the four borders.
    v_params = v_mode == 1 ? vec4(F(10) > 0.0 ? F(10) : source.x, F(11) > 0.0 ? F(11) : source.y, F(12), F(13)) : vec4(F(14), F(15), F(16), F(17));
    trim = vec4(0.0, 0.0, 1.0, 1.0); // both fill the whole sprite
  }
  // Mirroring is free: the corner moves to the other side of the sprite, trimmed frames included.
  vec2 at01 = trim.xy + a_corner * trim.zw;
  if (B(0) != 0u) at01.x = 1.0 - at01.x;
  if (B(1) != 0u) at01.y = 1.0 - at01.y;
  uint tint = U(1);
  v_tint = vec4(vec3(uvec3(tint >> 16u, tint >> 8u, tint) & 255u) / 255.0, clamp(F(6), 0.0, 1.0));
  vec2 local = (at01 - 0.5) * size;
  float c = cos(angle), s = sin(angle);
  vec2 world = position.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  gl_Position = u_viewProj * vec4(world, position.z, 1.0);
}`

// Particles move and fade in the shader from their birth data, so the CPU never touches them after a burst.
const PARTICLE_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_motion; // x, y, vx, vy
layout(location = 2) in vec4 a_life;   // gravity, birth, life, size
layout(location = 3) in vec4 a_uv;
layout(location = 4) in vec4 a_tint;
uniform mat4 u_viewProj;
uniform float u_time;
out vec2 v_uv;
out vec4 v_tint;
void main() {
  float age = u_time - a_life.y;
  float k = age / a_life.z;
  if (age < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // dead or unborn: clipped away
  vec2 p = a_motion.xy + a_motion.zw * age + vec2(0.0, 0.5 * a_life.x * age * age);
  v_uv = a_uv.xy + a_corner * a_uv.zw;
  v_tint = vec4(a_tint.rgb, a_tint.a * (1.0 - k));
  gl_Position = u_viewProj * vec4(p + (a_corner - 0.5) * a_life.w, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_tint;
out vec4 color;
// Textures are premultiplied, so alpha scales every channel.
void main() { color = texture(u_texture, v_uv) * vec4(v_tint.rgb, 1.0) * v_tint.a; }`

// Sprites: Tiling repeats the frame (fract), NineSlice maps each pixel so the borders keep their size.
const SPRITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_tint;
in vec2 v_local;
flat in vec4 v_rect;
flat in vec4 v_params;
flat in vec4 v_size;
flat in int v_mode;
out vec4 color;
// Sprite pixel p of a sprite \`size\` long to a pixel of a \`source\`-long frame whose borders a, b stay unscaled.
float slice(float p, float size, float source, float a, float b) {
  if (p < a) return p;
  if (p > size - b) return source - (size - p);
  return a + (p - a) * (source - a - b) / max(size - a - b, 1e-4);
}
void main() {
  vec2 uv = v_uv;
  if (v_mode == 1) uv = v_rect.xy + fract((v_local - v_params.zw) / v_params.xy) * v_rect.zw;
  else if (v_mode == 2) uv = v_rect.xy + vec2(slice(v_local.x, v_size.x, v_size.z, v_params.x, v_params.y), slice(v_local.y, v_size.y, v_size.w, v_params.z, v_params.w)) / v_size.zw * v_rect.zw;
  // Textures are premultiplied, so alpha scales every channel.
  color = texture(u_texture, uv) * vec4(v_tint.rgb, 1.0) * v_tint.a;
}`

function link(gl: WebGL2RenderingContext, vert: string, frag: string) {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
  return program
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
  return shader
}

/** Sprite renderer on WebGL2, available in every current browser. */
export const webgl2 =
  ({ background = [0.1, 0.1, 0.1, 1] }: RendererOptions = {}): Plugin =>
  (game) =>
    createRenderer(game, webgl2Backend(game.canvas, background))

interface ParticlePool {
  vao: WebGLVertexArrayObject
  buffer: WebGLBuffer
}

function webgl2Backend(canvas: HTMLCanvasElement, background: [number, number, number, number]): Backend<WebGLTexture, ParticlePool> {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true })
  if (!gl) throw new Error('WebGL2 is not available in this browser')

  const program = link(gl, VERT, SPRITE_FRAG)
  const uViewProj = gl.getUniformLocation(program, 'u_viewProj')
  const uBlend = gl.getUniformLocation(program, 'u_blend')
  const uCell = gl.getUniformLocation(program, 'u_cell')
  const uGrid = gl.getUniformLocation(program, 'u_grid')
  const uTexSize = gl.getUniformLocation(program, 'u_texSize')
  gl.useProgram(program)
  gl.uniform1i(gl.getUniformLocation(program, 'u_floats'), 1)
  gl.uniform1i(gl.getUniformLocation(program, 'u_uints'), 2)
  gl.uniform1i(gl.getUniformLocation(program, 'u_bytes'), 3)
  gl.uniform1i(gl.getUniformLocation(program, 'u_frames'), 4)
  // Atlas frame table: RGBA32F, 1024 texels per row. Starts as one texel so the sampler is always complete.
  const frameTexture = gl.createTexture()
  const uploadFrames = (table: Float32Array, texels: number) => {
    const rows = Math.max(1, Math.ceil(texels / 1024))
    const full = new Float32Array(rows * 1024 * 4)
    full.set(table)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, rows, 0, gl.RGBA, gl.FLOAT, full)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.activeTexture(gl.TEXTURE0)
  }
  uploadFrames(new Float32Array(0), 0)
  const particleProgram = link(gl, PARTICLE_VERT, FRAG)
  const uParticleViewProj = gl.getUniformLocation(particleProgram, 'u_viewProj')
  const uTime = gl.getUniformLocation(particleProgram, 'u_time')

  // One shared quad (TRIANGLE_STRIP) + one interleaved, instanced buffer.
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const instances = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, instances)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 4, 0)
  gl.vertexAttribDivisor(1, 1)

  // Component data: one texture array per type, one layer per field, 1024 entities per row.
  const kinds = [
    { unit: 1, internal: gl.R32F, format: gl.RED, type: gl.FLOAT },
    { unit: 2, internal: gl.R32UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_INT },
    { unit: 3, internal: gl.R8UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_BYTE },
  ].map((k) => ({ ...k, texture: null as WebGLTexture | null, rows: 0, layers: 0 }))
  const unpack = gl.createBuffer()
  const upload = (kind: (typeof kinds)[number], arrays: (ArrayBufferView | null)[], count: number) => {
    const layers = arrays.length
    // ponytail: rows grow with capacity; past ~2M entities (2048 rows) split into more textures
    const rows = Math.ceil((arrays[0] as Uint8Array).length / 1024)
    gl.activeTexture(gl.TEXTURE0 + kind.unit)
    if (rows > kind.rows || arrays.length > kind.layers) {
      gl.deleteTexture(kind.texture)
      kind.texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, kind.texture)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, kind.internal, 1024, rows, arrays.length)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      kind.rows = rows
      kind.layers = arrays.length
    }
    if (!count) return
    // Through a pixel unpack buffer: bufferSubData is the fast upload path, and the texture copies run on the GPU.
    const full = count >> 10
    const rest = count & 1023
    const bytes = count * (arrays[0] as Uint8Array).BYTES_PER_ELEMENT
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpack)
    gl.bufferData(gl.PIXEL_UNPACK_BUFFER, bytes * layers, gl.STREAM_DRAW)
    for (let layer = 0; layer < layers; layer++) {
      const a = arrays[layer]
      if (!a) continue // nothing reads this layer this frame (see SpriteData)
      const offset = layer * bytes
      gl.bufferSubData(gl.PIXEL_UNPACK_BUFFER, offset, a, 0, count)
      if (full) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 1024, full, 1, kind.format, kind.type, offset)
      if (rest) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, full, layer, rest, 1, 1, kind.format, kind.type, offset + full * 1024 * (bytes / count))
    }
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
  }

  gl.enable(gl.BLEND)
  // Premultiplied alpha: normal is src + dst * (1 - src alpha); additive is src + dst, and alpha still fades it.
  let adding: boolean | undefined
  const blend = (additive: boolean) => {
    if (additive !== adding) gl.blendFunc(gl.ONE, (adding = additive) ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA)
  }

  let view: Float32Array
  let screen: Float32Array
  let time = 0
  let bound: Float32Array | undefined
  /** Whether the sprite program and buffers are bound (particle draws switch them). */
  let sprites = false

  return {
    name: 'webgl2',
    createTexture(img, filter) {
      const texture = gl.createTexture()
      const mode = filter === 'nearest' ? gl.NEAREST : gl.LINEAR
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.activeTexture(gl.TEXTURE0)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mode)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mode)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return texture
    },
    begin(width, height, viewProj, screenProj, now) {
      view = viewProj
      screen = screenProj
      time = now
      sprites = false
      gl.viewport(0, 0, width, height)
      gl.clearColor(...background)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
    frames(table) {
      uploadFrames(table, table.length / 4)
    },
    sprites({ count, blend, floats, uints, bytes }) {
      // 3D uploads from arrays reject the premultiply flag that image uploads set.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      upload(kinds[0], floats, count)
      upload(kinds[1], uints, count)
      upload(kinds[2], bytes, count)
      gl.activeTexture(gl.TEXTURE0)
      gl.useProgram(program)
      gl.uniform1f(uBlend, blend)
      sprites = false
    },
    draw(ids, count, texture, onScreen, additive) {
      blend(additive)
      if (!sprites) {
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, instances)
        sprites = true
        bound = undefined
      }
      const proj = onScreen ? screen : view
      if (proj !== bound) gl.uniformMatrix4fv(uViewProj, false, (bound = proj))
      gl.bufferData(gl.ARRAY_BUFFER, ids.subarray(0, count), gl.STREAM_DRAW)
      gl.uniform4f(uCell, texture.fu, texture.fv, texture.su, texture.sv)
      gl.uniform4f(uGrid, texture.mu, texture.mv, texture.columns, texture.frames)
      gl.uniform2f(uTexSize, texture.width, texture.height)
      gl.bindTexture(gl.TEXTURE_2D, texture.handle)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    },
    createParticles(max) {
      const pool = { vao: gl.createVertexArray(), buffer: gl.createBuffer() }
      gl.bindVertexArray(pool.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, pool.buffer)
      gl.bufferData(gl.ARRAY_BUFFER, max * FLOATS_PER_PARTICLE * 4, gl.DYNAMIC_DRAW)
      const stride = FLOATS_PER_PARTICLE * 4
      for (const [location, offset] of [[1, 0], [2, 16], [3, 32]]) {
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, offset)
        gl.vertexAttribDivisor(location, 1)
      }
      gl.enableVertexAttribArray(4)
      gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, stride, 48)
      gl.vertexAttribDivisor(4, 1)
      gl.bindVertexArray(null)
      sprites = false
      return pool
    },
    writeParticles(pool, first, data) {
      gl.bindBuffer(gl.ARRAY_BUFFER, pool.buffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, first * FLOATS_PER_PARTICLE * 4, data)
      sprites = false
    },
    drawParticles(pool, count, texture, onScreen, additive) {
      blend(additive)
      gl.useProgram(particleProgram)
      gl.uniformMatrix4fv(uParticleViewProj, false, onScreen ? screen : view)
      gl.uniform1f(uTime, time)
      gl.bindVertexArray(pool.vao)
      gl.bindTexture(gl.TEXTURE_2D, texture.handle)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      sprites = false
    },
    end() {},
  }
}
