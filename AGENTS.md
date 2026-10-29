# Ollin: agent instructions

2D/2.5D game engine in TypeScript. Performance first, with a thin friendly API on top.

## Commands

```bash
npm run dev        # Vite dev server for examples/ (bunnymark, physics, platformer)
npm test           # Vitest
npm run typecheck  # tsc (noEmit)
```

Run `npm test` and `npm run typecheck` before calling a change done. For rendering or physics changes, also run the examples in a browser. For renderer or ECS hot-path changes, compare `examples/bench` (`ollin.html` vs `phaser.html` and `phaser-gpu.html?mode=cpu`, `?count=N`) before and after: it reports main-thread ms per frame. Measure with vsync on; with vsync off, GL backpressure shows up as work.

## Conventions

- **English only** for code, comments, identifiers, error messages, tests, commits and repository docs.
- **AI-generated working files** (plans, specs, notes, research, scratch docs) go in `.specs/`. It is gitignored because it is local and different for each developer. Never commit it and never make repository code or docs depend on it.
- Mexica/Nahuatl identity lives in branding, docs and example names. The public API stays in plain English (`createGame`, `spawn`, `query`) so beginners never have to learn Nahuatl to use the engine.
- Deliberate shortcuts carry a `// ponytail:` comment naming the limit and the upgrade path.

## Architecture rules

- **ECS (`src/ecs.ts`):** components are SoA typed arrays indexed by entity (`Position.x[e]`). Systems iterate `query.entities`. Never introduce per-entity objects on hot paths.
- **Never cache component arrays across frames** (`const { x } = Position` at module level). They are replaced when the world grows, and the same will happen when WASM memory grows. Read them at the top of each system run.
- `world.spawn` takes tuples only (`[Position, { x: 1 }]`, `[Tag]`) so TypeScript rejects unknown fields. Keep it that way.
- Built-in components live in `src/components.ts` (`Position`, `Rotation`, `Sprite`). The renderer draws every entity with `Position` + `Sprite`, centered on `Position` and rotated by `Rotation` if present.
- Component storage is global: only one `World` is live at a time, and a new one takes over its components with fresh storage.
- **Plugins** are `(game: Game) => void | Promise<void>`. They register resources with `game.set(token, value)` and systems with `game.system(fn, stage)`. The core must not import any plugin.
- **Stages:** `fixed` runs at `game.fixedDt` (default 1/60) as many times as the frame needs, then `update` and `render` once per frame. Physics and deterministic logic go in `fixed`.
- Plugins with heavy dependencies ship as subpath exports (`ollin/rapier`) and declare the dependency as an optional peer, so the core never downloads them.
- **Typed resources:** use `token<T>(name)`, never string keys.
- **Math:** `mat4` is column-major in a `Float32Array`, the same layout as WebGL and three.js. Positions are `vec3`; `z` is 2.5D depth today and a real axis for the future 3D plugin.
- **Rendering:** WebGL2 now. WebGPU comes later behind the same plugin shape. 3D will be a plugin backed by three.js, bridged through `InstancedMesh.instanceMatrix`, not one `Object3D` per entity.
- **Draw order:** sprites are batched per (z, texture). Higher `Position.z` draws on top; within the same z, texture id order, then spawn order. Use z for layers, not for per-sprite depth sorting (that needs a sorted index buffer, not built yet).
- **Assets are typed handles, never global string keys:** `renderer.loadTextures({ box: url })` and `audio.load({ jump: url })` return objects with typed keys. Spritesheets and tilesets are grids (`frameWidth`/`frameHeight`) and `Sprite.frame` picks the cell.
- **Camera** is a resource (`game.get(Camera)`) created by the renderer. The default view maps world pixels 1:1 to the canvas; use `camera.toWorld` for pointer coordinates.
- **Tiled** (`src/tiled.ts`): `loadTilemap` fetches a JSON map (.tmj, CSV layers, embedded or .tsj tilesets) and `spawnTilemap` turns it into entities, one per tile, with `z = base + layer index`. Hidden layers spawn `Position` only, for collision. Keep `spawnTilemap` free of DOM and fetch so it stays testable in Node.
- **WASM:** physics comes from Rapier (`src/rapier.ts`, `@dimforge/rapier2d-simd-compat`). Rapier owns its bodies, and a `fixed` system creates bodies for new entities, removes them for despawned ones and writes transforms back to `Position`/`Rotation`. Units: Rapier uses meters, the ECS uses pixels (`scale`, default 50 px/m). Write custom WASM only for measured hot paths.

## Roadmap

1. Minimal vertical slice: loop, WebGL2 sprites, input, bunnymark (done).
2. ECS: `defineComponent`, cached typed queries, renderer driven by `Position` + `Sprite` (done).
3. Rapier physics plugin with a fixed timestep (done).
4. Typed asset loading, spritesheets, z-ordered batches, camera, Web Audio, Tiled maps (done). Benchmarked against Phaser 4.2.1: 3–7x less main-thread work per frame at 1k–20k sprites (README, Performance).
5. WebGPU backend, scene HMR, devtools.

Out of scope for now: editor, networking, Canvas2D renderer.
