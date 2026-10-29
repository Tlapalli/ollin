<p align="center"><img src="brand/ollin.svg" width="120" alt="Ollin glyph"></p>

# Ollin

**Ollin** (Nahuatl: *movement*) is a 2D/2.5D game engine written in TypeScript. In the Mexica calendar, *Nahui Ollin* (4 Movement) is the sign of the Fifth Sun, the era we live in.

- **Performance first:** data lives in SoA `Float32Array`s that go straight to the GPU and can be shared with WASM.
- **Thin friendly layer:** `createGame`, `spawn`, `query`. The data-oriented core stays exposed for those who need it.
- **Plugins:** plain `(game) => void` functions. Rendering, input, audio, physics (`ollin/rapier`) and 3D are all optional.
- **Batteries that stay out of the way:** typed asset handles (no global string keys), spritesheets, a camera, and Tiled map import (orthogonal and isometric).
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

## Performance

`examples/bench` runs the same bouncing-sprite simulation in Ollin and in Phaser 4.2.1 on a 1280x720 canvas. Phaser runs it two ways: one `Image` game object per sprite (the idiomatic way), and a `SpriteGPULayer` updated with `editMember` every frame.

Each page reports main-thread work per frame: the time spent inside `requestAnimationFrame` callbacks (simulation, engine and WebGL calls). That is what eats the 16.6 ms budget of a 60 fps frame. Measured in Chromium with vsync on, on an Apple M4 Max with the CPU throttled 4x to approximate a mid-range phone:

| Sprites | Ollin | Phaser Image | Phaser GPU layer |
| ------: | ----: | -----------: | ---------------: |
| 1,000 | 0.05 ms | 0.35 ms | 0.16 ms |
| 5,000 | 0.21 ms | 1.54 ms | 1.08 ms |
| 10,000 | 0.52 ms | 3.33 ms | 1.96 ms |
| 20,000 | 1.34 ms | 6.87 ms | 3.99 ms |

At 20,000 sprites Phaser spends 41% of the frame budget on sprites alone; Ollin spends 8%. Results under 1 ms are noisy (CPU frequency scaling), so read them as ratios.

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
