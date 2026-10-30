import type { Plugin } from './core'
import { createRenderer, FLOATS_PER_PARTICLE, FLOATS_PER_SPRITE, type Backend, type RendererOptions } from './render'
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
const STAGE_VERTEX = 0x1
const STAGE_FRAGMENT = 0x2

const SHADER = /* wgsl */ `
struct Frame { viewProj: mat4x4f, time: f32 }
@group(0) @binding(0) var<uniform> frame: Frame;
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
  out.position = frame.viewProj * vec4f(world, s.position.z, 1.0);
  // The shared ortho matrix targets WebGL's -1..1 depth range; WebGPU clips to 0..1.
  out.position.z = out.position.z * 0.5 + 0.5;
  out.uv = s.uv.xy + corner * s.uv.zw;
  out.tint = s.tint;
  return out;
}

struct Particle {
  @builtin(vertex_index) vertex: u32,
  @location(0) motion: vec4f, // x, y, vx, vy
  @location(1) life: vec4f,   // gravity, birth, life, size
  @location(2) uv: vec4f,
  @location(3) tint: vec4f,
}

// Particles move and fade here from their birth data, so the CPU never touches them after a burst.
@vertex fn particle(p: Particle) -> Fragment {
  var out: Fragment;
  let age = frame.time - p.life.y;
  let k = age / p.life.z;
  if (age < 0.0 || k >= 1.0) {
    out.position = vec4f(2.0, 2.0, 2.0, 1.0); // dead or unborn: clipped away
    return out;
  }
  let corner = vec2f(f32(p.vertex & 1u), f32(p.vertex >> 1u));
  let at = p.motion.xy + p.motion.zw * age + vec2f(0.0, 0.5 * p.life.x * age * age);
  out.position = frame.viewProj * vec4f(at + (corner - 0.5) * p.life.w, 0.0, 1.0);
  out.position.z = out.position.z * 0.5 + 0.5;
  out.uv = p.uv.xy + corner * p.uv.zw;
  out.tint = vec4f(p.tint.rgb, p.tint.a * (1.0 - k));
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

function webgpuBackend(canvas: HTMLCanvasElement, device: GPUDevice, background: [number, number, number, number]): Backend<GPUBindGroup, GPUBuffer> {
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) throw new Error('WebGPU canvas context is not available')
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'premultiplied' })

  const module = device.createShaderModule({ code: SHADER })
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
  // Explicit layouts, so sprites and particles share the projection and texture bind groups.
  const frameLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: STAGE_VERTEX, buffer: {} }] })
  const textureLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: STAGE_FRAGMENT, texture: {} },
      { binding: 1, visibility: STAGE_FRAGMENT, sampler: {} },
    ],
  })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, textureLayout] })
  const fragment: GPUFragmentState = { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] }
  const pipeline = device.createRenderPipeline({
    layout,
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
    fragment,
    primitive: { topology: 'triangle-strip' },
  })
  const particlePipeline = device.createRenderPipeline({
    layout,
    vertex: {
      module,
      entryPoint: 'particle',
      buffers: [
        {
          arrayStride: FLOATS_PER_PARTICLE * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
            { shaderLocation: 2, offset: 32, format: 'float32x4' },
            { shaderLocation: 3, offset: 48, format: 'unorm8x4' },
          ],
        },
      ],
    },
    fragment,
    primitive: { topology: 'triangle-strip' },
  })

  // Both projections (each with the particle clock) live in one uniform buffer; bind group offsets must be 256-byte aligned.
  const uniforms = device.createBuffer({ size: 512, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
  const projection = (offset: number) => device.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: uniforms, offset, size: 80 } }] })
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
  /** Sprite draws index `instances`; particle draws carry their pool's buffer. */
  const draws: { particles?: GPUBuffer; first: number; count: number; texture: GPUBindGroup; screen: boolean }[] = []

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
        layout: textureLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: samplers[filter] },
        ],
      })
    },
    begin(_width, _height, view, screen, time) {
      const clock = new Float32Array([time])
      device.queue.writeBuffer(uniforms, 0, view)
      device.queue.writeBuffer(uniforms, 64, clock)
      device.queue.writeBuffer(uniforms, 256, screen)
      device.queue.writeBuffer(uniforms, 320, clock)
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
    createParticles(max) {
      return device.createBuffer({ size: max * FLOATS_PER_PARTICLE * 4, usage: BUFFER_VERTEX | BUFFER_COPY_DST })
    },
    writeParticles(buffer, first, data) {
      device.queue.writeBuffer(buffer, first * FLOATS_PER_PARTICLE * 4, data)
    },
    drawParticles(buffer, count, texture, screen) {
      draws.push({ particles: buffer, first: 0, count, texture, screen })
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
      let vertices: GPUBuffer | undefined
      let bound: boolean | undefined
      for (const d of draws) {
        const buffer = d.particles ?? instances!
        if (buffer !== vertices) {
          pass.setPipeline(d.particles ? particlePipeline : pipeline)
          pass.setVertexBuffer(0, (vertices = buffer))
        }
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
