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
- Mexica/Nahuatl identity lives in branding, docs and example names. The public API stays in plain English (`createGame`, `layer`, `add`) so beginners never have to learn Nahuatl to use the engine.
- Deliberate shortcuts carry a `// ponytail:` comment naming the limit and the upgrade path.

## Architecture rules

- **Data-oriented core:** component data is stored as SoA in `Float32Array`s (see `src/sprites.ts`). It is uploaded to the GPU and shared with WASM as-is. Never introduce per-entity objects on hot paths.
- **Plugins** are `(game: Game) => void | Promise<void>`. They register resources with `game.set(token, value)` and systems with `game.system(fn, stage)`. The core must not import any plugin.
- **Typed resources:** use `token<T>(name)`, never string keys.
- **Math:** `mat4` is column-major in a `Float32Array`, the same layout as WebGL and three.js. Positions are `vec3`; `z` is 2.5D depth today and a real axis for the future 3D plugin.
- **Rendering:** WebGL2 now. WebGPU comes later behind the same plugin shape. 3D will be a plugin backed by three.js, bridged through `InstancedMesh.instanceMatrix`, not one `Object3D` per entity.
- **WASM:** physics comes from Rapier. Write custom WASM only for measured hot paths.

## Roadmap

1. Minimal vertical slice: loop, WebGL2 sprites, input, bunnymark (done).
2. ECS: `defineComponent`, typed queries, on top of the same SoA storage.
3. Rapier physics plugin sharing memory with the ECS.
4. Assets, audio, tilemaps (Tiled), camera.
5. WebGPU backend, scene HMR, devtools.

Out of scope for now: editor, networking, Canvas2D renderer.
