import type { Plugin } from './core'
import { createRenderer, FLOATS_PER_SPRITE, type Backend, type RendererOptions } from './render'
import { webgl2 } from './webgl2'

// GPUBufferUsage / GPUTextureUsage flags from the spec; TypeScript's DOM lib has the WebGPU types but not these globals.
const MAP_WRITE = 0x2
const BUFFER_MAP_WRITE = 0x2
const BUFFER_COPY_SRC = 0x4
const BUFFER_COPY_DST = 0x8
const BUFFER_VERTEX = 0x20
const BUFFER_UNIFORM = 0x40
const TEXTURE_COPY_DST = 0x2
const TEXTURE_BINDING = 0x4
const TEXTURE_RENDER_ATTACHMENT = 0x10

const SHADER = /* wgsl */ `
@group(0) @binding(0) var<uniform> viewProj: mat4x4f;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct Sprite {
  @builtin(vertex_index) vertex: u32,
  @location(0) position: vec3f,
  @location(1) size: vec2f,
  @location(2) angle: f32,
  @location(3) uv: vec4f,
  @location(4) tint: vec4f,
}

struct Fragment {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec4f,
}

@vertex fn vs(s: Sprite) -> Fragment {
  // Quad corners from the vertex index (triangle strip), so no quad buffer is needed.
  let corner = vec2f(f32(s.vertex & 1u), f32(s.vertex >> 1u));
  let local = (corner - 0.5) * s.size;
  let c = cos(s.angle);
  let n = sin(s.angle);
  let world = s.position.xy + vec2f(local.x * c - local.y * n, local.x * n + local.y * c);
  var out: Fragment;
  out.position = viewProj * vec4f(world, s.position.z, 1.0);
  // The shared ortho matrix targets WebGL's -1..1 depth range; WebGPU clips to 0..1.
  out.position.z = out.position.z * 0.5 + 0.5;
  out.uv = s.uv.xy + corner * s.uv.zw;
  out.tint = s.tint;
  return out;
}

// Textures are premultiplied, so alpha scales every channel.
@fragment fn fs(f: Fragment) -> @location(0) vec4f {
  return textureSample(tex, samp, f.uv) * vec4f(f.tint.rgb, 1.0) * f.tint.a;
}`

/**
 * Sprite renderer on WebGPU, with the same API and output as `webgl2()`. Falls back to WebGL2 where WebGPU is not
 * available; `renderer.backend` tells which one runs.
 */
export const webgpu =
  (options: RendererOptions = {}): Plugin =>
  async (game) => {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) return webgl2(options)(game)
    const device = await adapter.requestDevice()
    // ponytail: no device-loss recovery (driver reset, GPU switch); recreate the device and re-upload textures if it bites
    createRenderer(game, webgpuBackend(game.canvas, device, options.background ?? [0.1, 0.1, 0.1, 1]))
  }

function webgpuBackend(canvas: HTMLCanvasElement, device: GPUDevice, background: [number, number, number, number]): Backend<GPUBindGroup> {
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) throw new Error('WebGPU canvas context is not available')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'premultiplied' })

  const module = device.createShaderModule({ code: SHADER })
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: FLOATS_PER_SPRITE * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
            { shaderLocation: 2, offset: 20, format: 'float32' },
            { shaderLocation: 3, offset: 24, format: 'float32x4' },
            { shaderLocation: 4, offset: 40, format: 'unorm8x4' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip' },
  })

  // Both projections live in one uniform buffer; bind group offsets must be 256-byte aligned.
  const uniforms = device.createBuffer({ size: 512, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
  const projection = (offset: number) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms, offset, size: 64 } }] })
  const viewGroup = projection(0)
  const screenGroup = projection(256)
  const samplers = {
    linear: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }),
    nearest: device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' }),
  }

  // Draws are recorded and run at submit, so the frame's batches are gathered into one array, then written into a
  // mapped staging buffer (shared memory, no copy through writeBuffer) that the GPU copies into the vertex buffer.
  // Each draw picks its slice with firstInstance. Staging buffers return to the pool once remapped.
  let frame = new Float32Array(1024 * FLOATS_PER_SPRITE)
  let used = 0
  let instances: GPUBuffer | undefined
  const pool: GPUBuffer[] = []
  const draws: { first: number; count: number; texture: GPUBindGroup; screen: boolean }[] = []

  return {
    name: 'webgpu',
    createTexture(img, filter) {
      const size = [img.width, img.height]
      const texture = device.createTexture({
        size,
        format: 'rgba8unorm',
        usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture({ source: img }, { texture, premultipliedAlpha: true }, size)
      return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: samplers[filter] },
        ],
      })
    },
    begin(_width, _height, view, screen) {
      device.queue.writeBuffer(uniforms, 0, view)
      device.queue.writeBuffer(uniforms, 256, screen)
    },
    draw(data, count, texture, screen) {
      const n = count * FLOATS_PER_SPRITE
      if (used + n > frame.length) {
        const next = new Float32Array(Math.max(used + n, frame.length * 2))
        next.set(frame.subarray(0, used))
        frame = next
      }
      frame.set(data.subarray(0, n), used)
      draws.push({ first: used / FLOATS_PER_SPRITE, count, texture, screen })
      used += n
    },
    end() {
      const bytes = used * 4
      const encoder = device.createCommandEncoder()
      let staging: GPUBuffer | undefined
      if (used) {
        if (!instances || instances.size < bytes) {
          instances?.destroy()
          instances = device.createBuffer({ size: Math.max(bytes, (instances?.size ?? 0) * 2), usage: BUFFER_VERTEX | BUFFER_COPY_DST })
        }
        // Too-small pooled buffers are dropped; the pool settles on the frame's size.
        while (pool.length && pool[pool.length - 1].size < bytes) pool.pop()!.destroy()
        staging = pool.pop() ?? device.createBuffer({ size: instances.size, usage: BUFFER_MAP_WRITE | BUFFER_COPY_SRC, mappedAtCreation: true })
        new Float32Array(staging.getMappedRange(0, bytes)).set(frame.subarray(0, used))
        staging.unmap()
        encoder.copyBufferToBuffer(staging, 0, instances, 0, bytes)
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: background, loadOp: 'clear', storeOp: 'store' }],
      })
      pass.setPipeline(pipeline)
      if (instances) pass.setVertexBuffer(0, instances)
      let bound: boolean | undefined
      for (const d of draws) {
        if (d.screen !== bound) pass.setBindGroup(0, (bound = d.screen) ? screenGroup : viewGroup)
        pass.setBindGroup(1, d.texture)
        pass.draw(4, d.count, 0, d.first)
      }
      pass.end()
      device.queue.submit([encoder.finish()])
      if (staging) {
        const done = staging
        done.mapAsync(MAP_WRITE).then(() => pool.push(done), () => done.destroy())
      }
      draws.length = 0
      used = 0
    },
  }
}
