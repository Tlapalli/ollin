# Ollin: agent instructions

2D/2.5D game engine in TypeScript. Performance first, with a thin friendly API on top.

## Commands

```bash
npm run dev        # Vite dev server for examples/bunnymark
npm test           # Vitest
npm run typecheck  # tsc (noEmit)
```

Run `npm test` and `npm run typecheck` before calling a change done. For rendering changes, also run the bunnymark in a browser.

## Conventions

- **English only** for code, comments, identifiers, error messages, tests, commits and repository docs.
- **AI-generated working files** (plans, specs, notes, research, scratch docs) go in `.specs/`. It is gitignored because it is local and different for each developer. Never commit it and never make repository code or docs depend on it.
- Mexica/Nahuatl identity lives in branding, docs and example names. The public API stays in plain English (`createGame`, `spawn`, `query`) so beginners never have to learn Nahuatl to use the engine.
- Deliberate shortcuts carry a `// ponytail:` comment naming the limit and the upgrade path.

## Architecture rules

- **ECS (`src/ecs.ts`):** components are SoA typed arrays indexed by entity (`Position.x[e]`). Systems iterate `query.entities`. Never introduce per-entity objects on hot paths.
- **Never cache component arrays across frames** (`const { x } = Position` at module level). They are replaced when the world grows, and the same will happen when WASM memory grows. Read them at the top of each system run.
- `world.spawn` takes tuples only (`[Position, { x: 1 }]`, `[Tag]`) so TypeScript rejects unknown fields. Keep it that way.
- Built-in components live in `src/components.ts` (`Position`, `Sprite`). The renderer draws every entity with both.
- **Plugins** are `(game: Game) => void | Promise<void>`. They register resources with `game.set(token, value)` and systems with `game.system(fn, stage)`. The core must not import any plugin.
- **Typed resources:** use `token<T>(name)`, never string keys.
- **Math:** `mat4` is column-major in a `Float32Array`, the same layout as WebGL and three.js. Positions are `vec3`; `z` is 2.5D depth today and a real axis for the future 3D plugin.
- **Rendering:** WebGL2 now. WebGPU comes later behind the same plugin shape. 3D will be a plugin backed by three.js, bridged through `InstancedMesh.instanceMatrix`, not one `Object3D` per entity.
- **WASM:** physics comes from Rapier. Write custom WASM only for measured hot paths.

## Roadmap

1. Minimal vertical slice: loop, WebGL2 sprites, input, bunnymark (done).
2. ECS: `defineComponent`, cached typed queries, renderer driven by `Position` + `Sprite` (done).
3. Rapier physics plugin sharing memory with the ECS.
4. Assets, audio, tilemaps (Tiled), camera.
5. WebGPU backend, scene HMR, devtools.

Out of scope for now: editor, networking, Canvas2D renderer.
