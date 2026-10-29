<p align="center"><img src="brand/ollin.svg" width="120" alt="Ollin glyph"></p>

# Ollin

**Ollin** (Nahuatl: *movement*) is a 2D/2.5D game engine written in TypeScript. In the Mexica calendar, *Nahui Ollin* (4 Movement) is the sign of the Fifth Sun, the era we live in.

- **Performance first:** data lives in SoA `Float32Array`s that go straight to the GPU and can be shared with WASM.
- **Thin friendly layer:** `createGame`, `spawn`, `query`. The data-oriented core stays exposed for those who need it.
- **Plugins:** plain `(game) => void` functions. Rendering, input, audio, physics (`ollin/rapier`) and 3D are all optional.
- **Batteries that stay out of the way:** typed asset handles (no global string keys), spritesheets, a camera, and Tiled map import (orthogonal and isometric).
- **Scenes with hot reload:** a level is a function; `game.scene(level)` swaps or restarts it, and Vite HMR restarts it in place when you save.
- **Sprites that do the usual things:** spritesheet animation (`Animation`), tint, alpha and flip per sprite, and bitmap text from any CSS or web font (`renderer.loadFont` + `spawnText`), with screen-space layers for HUDs.
- **Gameplay helpers:** `tween` any component field with easing, `after`/`every` timers that end with their scene, particle `burst`s, and input from keyboard, multi-touch and gamepads.
- **WebGL2 or WebGPU:** `webgl2()` runs everywhere; `webgpu()` is a drop-in with the same API and output, and falls back to WebGL2 where WebGPU is missing.
- **Devtools:** `devtools()` shows fps, main-thread ms per frame, entity, sprite and draw call counts; click a sprite to inspect its components live. Toggle with the key left of 1.
- **2.5D:** z layers, plus y-sorted layers (`renderer.ySort.add(z)`) so characters walk behind and in front of walls and trees.

```ts
const game = await createGame({ canvas, plugins: [webgl2(), input()] })
const texture = await game.get(Renderer).loadTexture('ollin.png')
const Velocity = defineComponent({ x: f32, y: f32 })

game.world.spawn([Position, { x: 100, y: 100 }], [Velocity, { x: 60 }], [Sprite, { w: 32, h: 32, texture }])

const moving = game.world.query(Position, Velocity)
game.system((dt) => {
  for (const e of moving.entities) {
    Position.x[e] += Velocity.x[e] * dt
    Position.y[e] += Velocity.y[e] * dt
  }
})
game.start()
```

## Install

```bash
npm install ollin
npm install @dimforge/rapier2d-simd-compat   # only if you use ollin/rapier
```

Ollin ships ES modules with TypeScript types and expects a bundler such as Vite. Rapier's own type definitions need `"skipLibCheck": true` (the Vite templates set it) or `"lib": ["ESNext", "DOM"]` in your `tsconfig.json`.

## Performance

`examples/bench` runs the same bouncing-sprite simulation in Ollin and in Phaser 4.2.1 on a 1280x720 canvas. Phaser runs it two ways: one `Image` game object per sprite (the idiomatic way), and a `SpriteGPULayer` updated with `editMember` every frame.

Each page reports main-thread work per frame: the time spent inside `requestAnimationFrame` callbacks (simulation, engine and WebGL calls). That is what eats the 16.6 ms budget of a 60 fps frame. Measured in Chromium with vsync on, on an Apple M4 Max with the CPU throttled 4x to approximate a mid-range phone:

| Sprites | Ollin | Phaser Image | Phaser GPU layer |
| ------: | ----: | -----------: | ---------------: |
| 1,000 | 0.07 ms | 0.33 ms | 0.16 ms |
| 5,000 | 0.28 ms | 1.58 ms | 0.90 ms |
| 10,000 | 0.78 ms | 2.94 ms | 1.93 ms |
| 20,000 | 1.97 ms | 7.06 ms | 3.99 ms |

At 20,000 sprites Phaser spends 42% of the frame budget on sprites alone; Ollin spends 12%, with per-sprite tint, alpha and flip included like Phaser's. Results under 1 ms are noisy (CPU frequency scaling), so read them as ratios.

The WebGPU backend (`bench/ollin.html?webgpu`) costs about the same as WebGL2: within ±25% across runs, a little ahead at 20,000 sprites and a little behind under 5,000. The time goes to packing sprites in JavaScript, which both backends share.

Open `bench/ollin.html?count=N`, `bench/phaser.html?count=N` and `bench/phaser-gpu.html?mode=cpu&count=N` from `npm run dev` to reproduce; each page prints its average and p95 work per frame after a 4 s run. `phaser-gpu.html?mode=gpu` moves sprites with shader tweens instead, a ceiling for static scenery rather than the same workload.

## Development

```bash
npm install
npm run dev        # examples: bunnymark, physics, a Tiled platformer, an isometric map and the Phaser benchmark
npm test
npm run typecheck
```

## Identity

The palette comes from the codices: red `#B5302A` (*tlapalli*), turquoise `#1F9E9A` (*xihuitl*), amate paper `#F3E6C9` (*amatl*), ink `#1B1B1B` (*tlilli*). *In tlilli in tlapalli*, "the black ink, the red ink", is the Nahuatl expression for writing and wisdom. The glyph in `brand/ollin.svg` is a simplified Ollin day sign: four lobes around a central eye.
