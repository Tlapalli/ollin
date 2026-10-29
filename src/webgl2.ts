import { Position, Sprite } from './components'
import { token, type Plugin } from './core'
import { mat4, ortho } from './math'

export interface Renderer {
  gl: WebGL2RenderingContext
  /** Loads an image and returns its texture id, to be stored in `Sprite.texture`. */
  loadTexture(url: string): Promise<number>
}

export const Renderer = token<Renderer>('Renderer')

const FLOATS_PER_SPRITE = 5 // x, y, z, w, h

const VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_position;
layout(location = 2) in vec2 a_size;
uniform mat4 u_viewProj;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = u_viewProj * vec4(a_position.xy + a_corner * a_size, a_position.z, 1.0);
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

/** Packed per-texture instance data, rebuilt every frame from the ECS. */
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
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 12)
    gl.vertexAttribDivisor(2, 1)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const viewProj = mat4()
    const textures: WebGLTexture[] = []
    const batches: Batch[] = []

    game.set(Renderer, {
      gl,
      async loadTexture(url) {
        const img = new Image()
        img.src = url
        await img.decode()
        const texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        batches.push({ data: new Float32Array(1024 * FLOATS_PER_SPRITE), count: 0 })
        return textures.push(texture) - 1
      },
    })

    const sprites = game.world.query(Position, Sprite)
    game.system(() => {
      // ponytail: gather copy from entity-indexed storage into packed batches, one draw per texture in id order (no z sort);
      // archetype tables or z-sorted batches if profiling or 2.5D scenes need them
      for (const batch of batches) batch.count = 0
      const { x, y, z } = Position
      const { w, h, texture } = Sprite
      for (const e of sprites.entities) {
        const batch = batches[texture[e]]
        if (!batch) continue
        if ((batch.count + 1) * FLOATS_PER_SPRITE > batch.data.length) {
          const data = new Float32Array(batch.data.length * 2)
          data.set(batch.data)
          batch.data = data
        }
        const o = batch.count++ * FLOATS_PER_SPRITE
        batch.data[o] = x[e]
        batch.data[o + 1] = y[e]
        batch.data[o + 2] = z[e]
        batch.data[o + 3] = w[e]
        batch.data[o + 4] = h[e]
      }

      const { width, height } = game.canvas
      gl.viewport(0, 0, width, height)
      gl.clearColor(...background)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniformMatrix4fv(uViewProj, false, ortho(viewProj, 0, width, height, 0, -1000, 1000))
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, instances)
      batches.forEach((batch, id) => {
        if (!batch.count) return
        gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.count * FLOATS_PER_SPRITE), gl.STREAM_DRAW)
        gl.bindTexture(gl.TEXTURE_2D, textures[id])
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count)
      })
    }, 'render')
  }
