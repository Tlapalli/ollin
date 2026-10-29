<p align="center"><img src="brand/ollin.svg" width="120" alt="Ollin glyph"></p>

# Ollin

**Ollin** (Nahuatl: *movement*) is a 2D/2.5D game engine written in TypeScript. In the Mexica calendar, *Nahui Ollin* (4 Movement) is the sign of the Fifth Sun, the era we live in.

- **Performance first:** data lives in SoA `Float32Array`s that go straight to the GPU and can be shared with WASM.
- **Thin friendly layer:** `createGame`, `layer`, `add`. The data-oriented core stays exposed for those who need it.
- **Plugins:** plain `(game) => void` functions. Rendering, input, physics and 3D are all optional.

```ts
const game = await createGame({ canvas, plugins: [webgl2(), input()] })
const renderer = game.get(Renderer)
const glyphs = renderer.layer(await renderer.loadTexture('ollin.png'))
glyphs.add(100, 100, 32, 32)
game.start()
```

## Development

```bash
npm install
npm run dev        # bunnymark: hold the mouse button to add sprites
npm test
npm run typecheck
```

## Identity

The palette comes from the codices: red `#B5302A` (*tlapalli*), turquoise `#1F9E9A` (*xihuitl*), amate paper `#F3E6C9` (*amatl*), ink `#1B1B1B` (*tlilli*). *In tlilli in tlapalli*, "the black ink, the red ink", is the Nahuatl expression for writing and wisdom. The glyph in `brand/ollin.svg` is a simplified Ollin day sign: four lobes around a central eye.
