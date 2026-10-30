import type { Plugin } from './core'
import { createRenderer, FLOATS_PER_PARTICLE, FLOATS_PER_SPRITE, type Backend, type RendererOptions } from './render'

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

  const program = link(gl, VERT, FRAG)
  const uViewProj = gl.getUniformLocation(program, 'u_viewProj')
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
    draw(data, count, texture, onScreen) {
      if (!sprites) {
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, instances)
        sprites = true
        bound = undefined
      }
      const proj = onScreen ? screen : view
      if (proj !== bound) gl.uniformMatrix4fv(uViewProj, false, (bound = proj))
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FLOATS_PER_SPRITE), gl.STREAM_DRAW)
      gl.bindTexture(gl.TEXTURE_2D, texture)
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
    drawParticles(pool, count, texture, onScreen) {
      gl.useProgram(particleProgram)
      gl.uniformMatrix4fv(uParticleViewProj, false, onScreen ? screen : view)
      gl.uniform1f(uTime, time)
      gl.bindVertexArray(pool.vao)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      sprites = false
    },
    end() {},
  }
}
