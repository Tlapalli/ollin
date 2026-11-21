import type { Plugin } from './core'
import { createRenderer, FLOATS_PER_PARTICLE, type Backend, type Clip, type LayerState, type RendererOptions, type SpriteData, type Texture } from './render'
import { webgl2 } from './webgl2'

// GPUBufferUsage / GPUTextureUsage flags from the spec; TypeScript's DOM lib has the WebGPU types but not these globals.
const MAP_WRITE = 0x2
const BUFFER_MAP_WRITE = 0x2
const BUFFER_COPY_SRC = 0x4
const BUFFER_COPY_DST = 0x8
const BUFFER_VERTEX = 0x20
const BUFFER_UNIFORM = 0x40
const BUFFER_STORAGE = 0x80
const TEXTURE_COPY_DST = 0x2
const TEXTURE_BINDING = 0x4
const TEXTURE_RENDER_ATTACHMENT = 0x10
const STAGE_VERTEX = 0x1
const STAGE_FRAGMENT = 0x2

const SHADER = /* wgsl */ `
struct Frame { viewProj: mat4x4f, time: f32, blend: f32, stride: u32 }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
struct Grid { cell: vec4f, grid: vec4f, size: vec4f } // frame size u, v, step u, v; margin u, v, columns, first atlas texel or -1; image px
@group(1) @binding(2) var<uniform> grid: Grid;
// The ECS component arrays, uploaded as they are: one layer of \`stride\` entities per field (see SpriteData).
@group(2) @binding(0) var<storage, read> floats: array<f32>;
@group(2) @binding(1) var<storage, read> uints: array<u32>;
@group(2) @binding(2) var<storage, read> bytes: array<u32>;
// Atlas frame table, 2 texels per frame (see Backend.frames).
@group(2) @binding(3) var<storage, read> frames: array<vec4f>;

fn F(layer: u32, e: u32) -> f32 { return floats[layer * frame.stride + e]; }
fn U(layer: u32, e: u32) -> u32 { return uints[layer * frame.stride + e]; }
fn B(layer: u32, e: u32) -> u32 {
  let i = layer * frame.stride + e;
  return (bytes[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
}

struct Fragment {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec4f,
  // Tiling and NineSlice pick their UVs per pixel, in fs. Zero (mode 0) for plain sprites and particles.
  @location(2) local: vec2f,
  @location(3) @interpolate(flat) rect: vec4f,
  @location(4) @interpolate(flat) params: vec4f,
  @location(5) @interpolate(flat) size: vec4f,
  @location(6) @interpolate(flat) mode: u32,
}

// Sprites arrive as entity ids; everything else is read from the component arrays.
@vertex fn vs(@builtin(vertex_index) vertex: u32, @location(0) e: u32) -> Fragment {
  // Quad corners from the vertex index (triangle strip), so no quad buffer is needed.
  let corner = vec2f(f32(vertex & 1u), f32(vertex >> 1u));
  var position = vec3f(F(0u, e), F(1u, e), F(2u, e));
  var angle = select(0.0, F(5u, e), B(2u, e) == 1u);
  if (frame.blend >= 0.0 && B(3u, e) != 0u && B(4u, e) == 1u) {
    position = vec3f(mix(vec2f(F(7u, e), F(8u, e)), position.xy, frame.blend), position.z);
    let turn = angle - F(9u, e);
    angle = F(9u, e) + (turn - 6.2831853 * round(turn / 6.2831853)) * frame.blend; // shortest way around
  }
  let f = U(0u, e);
  var uv: vec2f;
  var cell: vec2f;
  var trim = vec4f(0.0, 0.0, 1.0, 1.0); // where the frame's pixels sit inside the sprite
  if (grid.grid.w >= 0.0) {
    let i = u32(grid.grid.w) + f * 2u;
    uv = frames[i].xy;
    cell = frames[i].zw;
    trim = frames[i + 1u];
  } else {
    let columns = u32(grid.grid.z);
    uv = grid.grid.xy + vec2f(f32(f % columns), f32(f / columns)) * grid.cell.zw;
    cell = grid.cell.xy;
  }
  var out: Fragment;
  let size = vec2f(F(3u, e), F(4u, e));
  out.mode = select(select(0u, 2u, B(6u, e) == 1u), 1u, B(5u, e) == 1u);
  if (out.mode != 0u) {
    let source = cell * grid.size.xy; // the frame's size in image pixels
    out.rect = vec4f(uv, cell);
    out.size = vec4f(size, source);
    out.local = corner * size;
    // Tiling: a repetition is w x h pixels (0 = the frame's size), shifted by x, y. NineSlice: the four borders.
    if (out.mode == 1u) {
      out.params = vec4f(select(source.x, F(10u, e), F(10u, e) > 0.0), select(source.y, F(11u, e), F(11u, e) > 0.0), F(12u, e), F(13u, e));
    } else {
      out.params = vec4f(F(14u, e), F(15u, e), F(16u, e), F(17u, e));
    }
    trim = vec4f(0.0, 0.0, 1.0, 1.0); // both fill the whole sprite
  }
  // Mirroring is free: the corner moves to the other side of the sprite, trimmed frames included.
  var at01 = trim.xy + corner * trim.zw;
  if (B(0u, e) != 0u) { at01.x = 1.0 - at01.x; }
  if (B(1u, e) != 0u) { at01.y = 1.0 - at01.y; }
  let tint = U(1u, e);
  let local = (at01 - 0.5) * size;
  let c = cos(angle);
  let n = sin(angle);
  let world = position.xy + vec2f(local.x * c - local.y * n, local.x * n + local.y * c);
  out.position = frame.viewProj * vec4f(world, position.z, 1.0);
  // The shared ortho matrix targets WebGL's -1..1 depth range; WebGPU clips to 0..1.
  out.position.z = out.position.z * 0.5 + 0.5;
  out.uv = uv + corner * cell;
  out.tint = vec4f(vec3f(vec3u(tint >> 16u, tint >> 8u, tint) & vec3u(255u)) / 255.0, clamp(F(6u, e), 0.0, 1.0));
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

// Sprite pixel p of a sprite \`size\` long to a pixel of a \`source\`-long frame whose borders a, b stay unscaled.
fn slice(p: f32, size: f32, source: f32, a: f32, b: f32) -> f32 {
  if (p < a) { return p; }
  if (p > size - b) { return source - (size - p); }
  return a + (p - a) * (source - a - b) / max(size - a - b, 1e-4);
}

// Textures are premultiplied, so alpha scales every channel.
@fragment fn fs(f: Fragment) -> @location(0) vec4f {
  var uv = f.uv;
  if (f.mode == 1u) {
    uv = f.rect.xy + fract((f.local - f.params.zw) / f.params.xy) * f.rect.zw;
  } else if (f.mode == 2u) {
    uv = f.rect.xy + vec2f(slice(f.local.x, f.size.x, f.size.z, f.params.x, f.params.y), slice(f.local.y, f.size.y, f.size.w, f.params.z, f.params.w)) / f.size.zw * f.rect.zw;
  }
  return textureSample(tex, samp, uv) * vec4f(f.tint.rgb, 1.0) * f.tint.a;
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

/** A texture's view and sampler; the bind group (with the frame grid) is made on first draw. */
interface GpuTexture {
  view: GPUTextureView
  sampler: GPUSampler
}

// Component layers start at multiples of this many entities, so every layer (bytes included) is 256-byte aligned.
const LAYER_ALIGN = 64
// Layer counts per type, as in SpriteData.
const FLOAT_LAYERS = 18
const UINT_LAYERS = 2
const BYTE_LAYERS = 7

function webgpuBackend(canvas: HTMLCanvasElement, device: GPUDevice, background: [number, number, number, number]): Backend<GpuTexture, GPUBuffer> {
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
      { binding: 2, visibility: STAGE_VERTEX, buffer: {} },
    ],
  })
  const storage = { visibility: STAGE_VERTEX, buffer: { type: 'read-only-storage' as const } }
  const dataLayout = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((binding) => ({ binding, ...storage })) })
  // Premultiplied alpha: normal is src + dst * (1 - src alpha); additive is src + dst, and alpha still fades it.
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one' }
  const fragments = [blend, add].map((b): GPUFragmentState => ({ module, entryPoint: 'fs', targets: [{ format, blend: { color: b, alpha: b } }] }))
  const [pipeline, additivePipeline] = fragments.map((fragment) => device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, textureLayout, dataLayout] }),
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [{ arrayStride: 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }] }],
    },
    fragment,
    primitive: { topology: 'triangle-strip' },
  }))
  const [particlePipeline, additiveParticlePipeline] = fragments.map((fragment) => device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, textureLayout] }),
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
  }))

  // Both projections (each with the particle clock, blend and layer stride) live in one uniform buffer; bind group
  // offsets must be 256-byte aligned.
  const uniforms = device.createBuffer({ size: 512, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
  const projection = (offset: number) => device.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: uniforms, offset, size: 80 } }] })
  const viewGroup = projection(0)
  const screenGroup = projection(256)
  const samplers = {
    linear: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }),
    nearest: device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' }),
  }
  const textureGroups = new WeakMap<object, GPUBindGroup>()
  const textureGroup = (t: Texture<GpuTexture>) => {
    let group = textureGroups.get(t)
    if (!group) {
      const grid = device.createBuffer({ size: 48, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
      device.queue.writeBuffer(grid, 0, new Float32Array([t.fu, t.fv, t.su, t.sv, t.mu, t.mv, t.columns, t.frames, t.width, t.height, 0, 0]))
      group = device.createBindGroup({
        layout: textureLayout,
        entries: [
          { binding: 0, resource: t.handle.view },
          { binding: 1, resource: t.handle.sampler },
          { binding: 2, resource: { buffer: grid } },
        ],
      })
      textureGroups.set(t, group)
    }
    return group
  }

  // Draws are recorded and run at submit. Each frame, the component layers and the frame's sprite ids are written into
  // a mapped staging buffer (shared memory; queue.writeBuffer cost ~0.9 ms of main thread per MB) that the GPU copies
  // into one buffer used both as storage (layers) and as the instance buffer (ids, after the layers).
  // Each draw picks its ids with firstInstance. Staging buffers return to the pool once remapped.
  let data: SpriteData | undefined
  let stride = 0
  let ids = new Uint32Array(4096)
  let used = 0
  let gpu: GPUBuffer | undefined
  let dataGroup: GPUBindGroup | undefined
  /** The layer stride `dataGroup` was made for. */
  let groupStride = 0
  const pool: GPUBuffer[] = []
  const draws: { particles?: GPUBuffer; first: number; count: number; texture: GPUBindGroup; layer: LayerState }[] = []
  let layer: LayerState = { screen: false, additive: false, clip: null }
  const params = new ArrayBuffer(8)
  // Atlas frame table; starts as one zero frame so the binding is never empty.
  let frameBuffer = device.createBuffer({ size: 32, usage: BUFFER_STORAGE | BUFFER_COPY_DST })

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
      return { view: texture.createView(), sampler: samplers[filter] }
    },
    begin(_width, _height, view, screen, time) {
      const clock = new Float32Array([time])
      device.queue.writeBuffer(uniforms, 0, view)
      device.queue.writeBuffer(uniforms, 64, clock)
      device.queue.writeBuffer(uniforms, 256, screen)
      device.queue.writeBuffer(uniforms, 320, clock)
    },
    frames(table) {
      frameBuffer.destroy()
      frameBuffer = device.createBuffer({ size: Math.max(32, table.byteLength), usage: BUFFER_STORAGE | BUFFER_COPY_DST })
      device.queue.writeBuffer(frameBuffer, 0, table)
      groupStride = 0 // rebuild the data bind group with the new buffer
    },
    sprites(next) {
      data = next
      stride = Math.ceil(next.floats[0]!.length / LAYER_ALIGN) * LAYER_ALIGN
      new Float32Array(params, 0, 1)[0] = next.blend
      new Uint32Array(params, 4, 1)[0] = stride
      device.queue.writeBuffer(uniforms, 68, params)
      device.queue.writeBuffer(uniforms, 324, params)
    },
    layer(state) {
      layer = state
    },
    draw(frameIds, count, texture) {
      if (used + count > ids.length) {
        const next = new Uint32Array(Math.max(used + count, ids.length * 2))
        next.set(ids.subarray(0, used))
        ids = next
      }
      ids.set(frameIds.subarray(0, count), used)
      draws.push({ first: used, count, texture: textureGroup(texture), layer })
      used += count
    },
    createParticles(max) {
      return device.createBuffer({ size: max * FLOATS_PER_PARTICLE * 4, usage: BUFFER_VERTEX | BUFFER_COPY_DST })
    },
    writeParticles(buffer, first, particles) {
      device.queue.writeBuffer(buffer, first * FLOATS_PER_PARTICLE * 4, particles)
    },
    drawParticles(buffer, count, texture) {
      draws.push({ particles: buffer, first: 0, count, texture: textureGroup(texture), layer })
    },
    end() {
      const encoder = device.createCommandEncoder()
      // Layout: float layers, uint layers, byte layers (each `stride` entities), then the ids.
      const floatBytes = FLOAT_LAYERS * stride * 4
      const uintBytes = UINT_LAYERS * stride * 4
      const idsAt = floatBytes + uintBytes + BYTE_LAYERS * stride
      const bytes = idsAt + used * 4
      let staging: GPUBuffer | undefined
      if (used && data) {
        if (!gpu || gpu.size < bytes || groupStride !== stride) {
          if (!gpu || gpu.size < bytes) {
            gpu?.destroy()
            gpu = device.createBuffer({ size: Math.max(bytes, (gpu?.size ?? 0) * 2), usage: BUFFER_STORAGE | BUFFER_VERTEX | BUFFER_COPY_DST })
          }
          dataGroup = device.createBindGroup({
            layout: dataLayout,
            entries: [
              { binding: 0, resource: { buffer: gpu, offset: 0, size: floatBytes } },
              { binding: 1, resource: { buffer: gpu, offset: floatBytes, size: uintBytes } },
              { binding: 2, resource: { buffer: gpu, offset: floatBytes + uintBytes, size: BYTE_LAYERS * stride } },
              { binding: 3, resource: { buffer: frameBuffer } },
            ],
          })
          groupStride = stride
        }
        // Too-small pooled buffers are dropped; the pool settles on the frame's size.
        while (pool.length && pool[pool.length - 1].size < bytes) pool.pop()!.destroy()
        staging = pool.pop() ?? device.createBuffer({ size: gpu.size, usage: BUFFER_MAP_WRITE | BUFFER_COPY_SRC, mappedAtCreation: true })
        const mapped = new Uint8Array(staging.getMappedRange(0, bytes))
        const { count, floats, uints, bytes: flags } = data
        // Null layers are not read this frame (see SpriteData).
        const write = (arrays: (ArrayBufferView | null)[], at: number, size: number) => {
          arrays.forEach((a, l) => a && mapped.set(new Uint8Array(a.buffer, a.byteOffset, count * size), at + l * stride * size))
        }
        write(floats, 0, 4)
        write(uints, floatBytes, 4)
        write(flags, floatBytes + uintBytes, 1)
        new Uint32Array(mapped.buffer, idsAt, used).set(ids.subarray(0, used))
        staging.unmap()
        encoder.copyBufferToBuffer(staging, 0, gpu, 0, bytes)
      }
      const target = context.getCurrentTexture()
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), clearValue: background, loadOp: 'clear', storeOp: 'store' }],
      })
      let vertices: GPUBuffer | undefined
      let bound: boolean | undefined
      let piped: GPURenderPipeline | undefined
      let clipped: Clip | null | undefined
      for (const d of draws) {
        const buffer = d.particles ?? gpu!
        const { additive, screen, clip } = d.layer
        if (clip !== clipped) {
          // WebGPU rejects a scissor rect outside the target, so clamp it.
          const x = Math.min(Math.max(0, Math.round(clip?.x ?? 0)), target.width)
          const y = Math.min(Math.max(0, Math.round(clip?.y ?? 0)), target.height)
          const right = clip ? Math.min(target.width, Math.max(x, Math.round(clip.x + clip.w))) : target.width
          const bottom = clip ? Math.min(target.height, Math.max(y, Math.round(clip.y + clip.h))) : target.height
          pass.setScissorRect(x, y, right - x, bottom - y)
          clipped = clip
        }
        const next = d.particles ? (additive ? additiveParticlePipeline : particlePipeline) : additive ? additivePipeline : pipeline
        if (next !== piped) pass.setPipeline((piped = next))
        if (buffer !== vertices) {
          if (d.particles) pass.setVertexBuffer(0, buffer)
          else {
            pass.setVertexBuffer(0, buffer, idsAt)
            pass.setBindGroup(2, dataGroup!)
          }
          vertices = buffer
        }
        if (screen !== bound) pass.setBindGroup(0, (bound = screen) ? screenGroup : viewGroup)
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
