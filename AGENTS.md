# Ollin: agent instructions

2D/2.5D game engine in TypeScript. Performance first, with a thin friendly API on top.

## Commands

```bash
npm run dev        # Vite dev server for examples/ (bunnymark, physics, platformer, iso, bench)
npm test           # Vitest
npm run typecheck  # tsc (noEmit)
npm run build      # dist/: Vite library build (JS) + tsc declarations
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
- Built-in components live in `src/components.ts` (`Position`, `Rotation`, `Sprite`, `Animation`, `Particle`). The renderer draws every entity with `Position` + `Sprite`, centered on `Position` and rotated by `Rotation` if present, and advances `Animation` (it writes `Sprite.frame`) and `Particle` (moves, fades, despawns; spawn them with `burst`). `Sprite.tint` (0xRRGGBB, multiplies, so it shows true colors only on white art) and `alpha` travel as one packed RGBA word; `flipX`/`flipY` cost nothing (mirrored UVs).
- Components can declare defaults: `defineComponent({ hp: u16 }, { hp: 3 })`. Use them whenever 0 would be a broken value (`Sprite.alpha`, `Sprite.tint`, `Animation.count`), so `spawn` stays short for beginners.
- Component storage is global: only one `World` is live at a time, and a new one takes over its components with fresh storage.
- **Plugins** are `(game: Game) => void | Promise<void>`. They register resources with `game.set(token, value)` and systems with `game.system(fn, stage)`. The core must not import any plugin.
- **Scenes:** a scene is `(game) => cleanup?`. `game.scene(fn)` removes the systems the previous scene registered, runs its cleanup and calls `world.clear()`, then runs the new one; plugin systems and resources stay. Restart = call it again with the same scene. Hot reload is one line in the entry file: `import.meta.hot?.accept('./level', (m) => m && game.scene(m.level))` (see `examples/platformer`). Loaders (`loadTexture`, `audio.load`) cache by URL so restarts do not re-upload assets. Plugins must survive `world.clear()`: keep their queries and react to despawned entities, as the Rapier plugin does.
- **Stages:** `fixed` runs at `game.fixedDt` (default 1/60) as many times as the frame needs, then `update` and `render` once per frame. Physics and deterministic logic go in `fixed`.
- Plugins with heavy dependencies ship as subpath exports (`ollin/rapier`) and declare the dependency as an optional peer, so the core never downloads them. Each subpath is a build entry in `vite.lib.ts` and an `exports` entry in `package.json`; shared modules land in one chunk so component storage stays a single instance.
- **Typed resources:** use `token<T>(name)`, never string keys.
- **Math:** `mat4` is column-major in a `Float32Array`, the same layout as WebGL and three.js. Positions are `vec3`; `z` is 2.5D depth today and a real axis for the future 3D plugin.
- **Rendering:** WebGL2 now. WebGPU comes later behind the same plugin shape. 3D will be a plugin backed by three.js, bridged through `InstancedMesh.instanceMatrix`, not one `Object3D` per entity.
- **Draw order:** sprites are batched per (z, texture). Higher `Position.z` draws on top; within the same z, texture id order, then spawn order. Layers in `renderer.ySort` draw instead in order of each sprite's bottom edge (`y + h / 2`), splitting draw calls only where the texture changes, so put sprites that interleave (walls, trees, characters) on one sorted layer and share a texture when you can. The sort reuses last frame's order, so it is cheap while most sprites stay put.
- **Assets are typed handles, never global string keys:** `renderer.loadTextures({ box: url })` and `audio.load({ jump: url })` return objects with typed keys. Spritesheets and tilesets are grids (`frameWidth`/`frameHeight`) and `Sprite.frame` picks the cell.
- **Screen layers and text:** z layers in `renderer.screen` ignore the camera and use canvas pixels (HUD, menus). `renderer.loadFont` renders printable ASCII of any CSS font into a white spritesheet; `spawnText` (`src/text.ts`, DOM-free) lays it out as one sprite per character, so text batches and tints like everything else.
- **Tweens and timers** (`src/tween.ts`) are systems that remove themselves: `game.system` returns a remover. Registered inside a scene, they end with it. Anything that holds an entity across frames must save `world.generation(e)` and stop when it changes, because ids are recycled (see `tween`).
- **Input** is state, not events: `keys`, `pointer` (last one), `pointers` (every pressed finger, for multi-touch), `gamepads` (Gamepad API, standard mapping, refreshed in `fixed`). The plugin sets `touch-action: none` on the canvas.
- **Devtools** (`src/devtools.ts`) is a DOM overlay, not sprites, so it survives `world.clear()` and stays out of the counts it shows. It measures main-thread work by wrapping `game.step` and reads `renderer.stats` (draw calls and sprites, reset each frame). Components show in the inspector only if named: built-ins always, others through `devtools({ components: { Velocity } })`.
- **Camera** is a resource (`game.get(Camera)`) created by the renderer. The default view maps world pixels 1:1 to the canvas; use `camera.toWorld` for pointer coordinates.
- **Tiled** (`src/tiled.ts`): `loadTilemap` fetches a JSON map (.tmj, orthogonal or isometric, CSV layers, embedded or .tsj tilesets) and `spawnTilemap` turns it into entities, one per tile, with `z = base + layer index`. Hidden layers spawn `Position` only, for collision. Tile images sit on the bottom of their cell like in Tiled, so tall isometric blocks grow upward. Keep `spawnTilemap` free of DOM and fetch so it stays testable in Node.
- **WASM:** physics comes from Rapier (`src/rapier.ts`, `@dimforge/rapier2d-simd-compat`). Rapier owns its bodies, and a `fixed` system creates bodies for new entities, removes them for despawned ones and writes transforms back to `Position`/`Rotation`. Units: Rapier uses meters, the ECS uses pixels (`scale`, default 50 px/m). Write custom WASM only for measured hot paths.

## Roadmap

1. Minimal vertical slice: loop, WebGL2 sprites, input, bunnymark (done).
2. ECS: `defineComponent`, cached typed queries, renderer driven by `Position` + `Sprite` (done).
3. Rapier physics plugin with a fixed timestep (done).
4. Typed asset loading, spritesheets, z-ordered batches, camera, Web Audio, Tiled maps (done). Benchmarked against Phaser 4.2.1: 3–7x less main-thread work per frame at 1k–20k sprites (README, Performance).
5. 2.5D: y-sorted layers and isometric Tiled maps (done).
6. Packaging: dist build, typed exports, CI workflow, MIT license (done; GitHub repo and npm release pending).
7. Scenes and hot reload (done).
8. Sprite animation, tint/alpha/flip, bitmap text and screen layers (done).
9. Devtools: stats overlay and entity inspector (done).
10. Gameplay helpers: tweens and timers, multi-touch and gamepad input, particles (done).
11. WebGPU backend.

Out of scope for now: editor, networking, Canvas2D renderer.
