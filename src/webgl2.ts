import { token, type Plugin } from './core'
import { mat4, ortho } from './math'
import { SPRITE_FIELDS, Sprites } from './sprites'

export interface Layer {
  sprites: Sprites
  texture: WebGLTexture
}

export interface Renderer {
  gl: WebGL2RenderingContext
  /** Layers drawn in order. ponytail: one texture per layer; add an atlas when there are many images. */
  layers: Layer[]
  loadTexture(url: string): Promise<WebGLTexture>
  /** Creates a sprite layer bound to a texture and adds it to the render. */
  layer(texture: WebGLTexture, capacity?: number): Sprites
}

export const Renderer = token<Renderer>('Renderer')

const VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in float a_x;
layout(location = 2) in float a_y;
layout(location = 3) in float a_z;
layout(location = 4) in float a_w;
layout(location = 5) in float a_h;
uniform mat4 u_viewProj;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = u_viewProj * vec4(a_x + a_corner.x * a_w, a_y + a_corner.y * a_h, a_z, 1.0);
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

    // One shared quad (TRIANGLE_STRIP) + one instanced buffer per SoA field.
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const fieldBuffers = SPRITE_FIELDS.map((_, i) => {
      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(i + 1)
      gl.vertexAttribPointer(i + 1, 1, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(i + 1, 1)
      return buffer
    })

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const viewProj = mat4()

    const renderer: Renderer = {
      gl,
      layers: [],
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
        return texture
      },
      layer(texture, capacity) {
        const sprites = new Sprites(capacity)
        renderer.layers.push({ sprites, texture })
        return sprites
      },
    }

    game.set(Renderer, renderer)
    game.system(() => {
      const { width, height } = game.canvas
      gl.viewport(0, 0, width, height)
      gl.clearColor(...background)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniformMatrix4fv(uViewProj, false, ortho(viewProj, 0, width, height, 0, -1000, 1000))
      gl.bindVertexArray(vao)

      for (const { sprites, texture } of renderer.layers) {
        if (!sprites.count) continue
        SPRITE_FIELDS.forEach((field, i) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, fieldBuffers[i])
          gl.bufferData(gl.ARRAY_BUFFER, sprites[field].subarray(0, sprites.count), gl.STREAM_DRAW)
        })
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sprites.count)
      }
    }, 'render')
  }
