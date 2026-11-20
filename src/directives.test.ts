import { expect, it } from 'vitest'
import { compileDirectives, declareDirectives, parseDirectives } from './directives'

const source = `
// The whole game in one place.
#game(width: 1280, height: 720, background: #1b1b1b, pixelArt: true)
#texture tiles ./art/tiles.png (frame: 16x16, spacing: 1)
#atlas   hero  ./art/hero.json
#sound   jump  sfx/jump.wav
#font    ui    (family: "Press Start 2P, monospace", size: 16)
#map     level ./maps/level.tmj (z: 2)
`

it('parses directives with names, paths and typed options', () => {
  const d = parseDirectives(source)
  expect(d.map((x) => [x.kind, x.name, x.path, x.line])).toEqual([
    ['game', '', '', 3],
    ['texture', 'tiles', './art/tiles.png', 4],
    ['atlas', 'hero', './art/hero.json', 5],
    ['sound', 'jump', 'sfx/jump.wav', 6],
    ['font', 'ui', '', 7],
    ['map', 'level', './maps/level.tmj', 8],
  ])
  expect(d[0].options).toEqual({ width: 1280, height: 720, background: { color: 0x1b1b1b }, pixelArt: true })
  expect(d[1].options).toEqual({ frame: { w: 16, h: 16 }, spacing: 1 })
  expect(d[4].options.family).toBe('Press Start 2P, monospace') // the comma inside quotes stays
})

it('compiles to a module that creates the game and loads every asset in parallel', () => {
  const code = compileDirectives(parseDirectives(source), 'ollin')
  expect(code).toContain('import { createGame, input, Renderer, webgl2, audio, Audio, loadTilemap } from "ollin"')
  expect(code).toContain('import url0 from "./art/tiles.png?url"')
  expect(code).toContain('import url2 from "./sfx/jump.wav?url"') // bare paths are relative to the file
  expect(code).toContain('plugins: [webgl2({ background: [0.1059, 0.1059, 0.1059, 1] }), input(), audio()]')
  expect(code).toContain('renderer.loadTexture(url0, {"frameWidth":16,"frameHeight":16,"spacing":1,"filter":"nearest"})')
  expect(code).toContain('loadTilemap(game, url4, { z: 2 })')
  expect(code).toContain('export const assets = { tiles: loaded[0], hero: loaded[1], jump: loaded[2], ui: loaded[3], level: loaded[4] }')
  expect(() => new Function(code.replace(/^import .*$/gm, '').replace(/export /g, '').replace(/await /g, ''))).not.toThrow() // valid JS
})

it('declares typed assets for the editor', () => {
  expect(declareDirectives(parseDirectives(source), 'ollin')).toContain(
    'export declare const assets: { tiles: number; hero: Atlas; jump: AudioBuffer; ui: Font; level: Tilemap }',
  )
})

it('reports mistakes with their line', () => {
  const error = (text: string) => {
    try {
      parseDirectives(text)
    } catch (e) {
      return (e as Error).message
    }
  }
  expect(error('#sprite hero ./a.png')).toMatch(/line 1: unknown directive #sprite/)
  expect(error('\n#texture ./a.png')).toMatch(/line 2: #texture needs a name/)
  expect(error('#texture hero')).toMatch(/needs a file path/)
  expect(error('#texture a ./a.png\n#sound a ./a.wav')).toMatch(/line 2: "a" is declared twice/)
  expect(error('#texture a ./a.png (frames: 16x16)')).toMatch(/no option "frames"; it takes frame, margin, spacing, filter/)
  expect(error('#game(width: 1280)\n#game(height: 720)')).toMatch(/line 2: #game appears twice/)
  expect(error('#font ui (family: Press Start)')).toMatch(/can't read the value "Press Start"/)
  expect(error('texture a ./a.png')).toMatch(/expected a directive/)
})

it('uses public paths as they are and bundles the image of each relative atlas', () => {
  const d = parseDirectives('#atlas hero ./art/hero.json (filter: nearest)\n#map level /maps/level.tmj\n#sound jump /sfx/jump.wav')
  const code = compileDirectives(d, 'ollin', { hero: './art/hero.png' })
  expect(code).toContain('import image0 from "./art/hero.png?url"')
  expect(code).toContain('renderer.loadAtlas(url0, {"filter":"nearest","image":image0})')
  expect(code).toContain('loadTilemap(game, "/maps/level.tmj")')
  expect(code).toContain('load({ sound: "/sfx/jump.wav" })')
  expect(code).not.toContain('url1')
  expect(compileDirectives(parseDirectives('#atlas a ./a.json'), 'ollin', { a: './a.png' })).toContain('renderer.loadAtlas(url0, {"image":image0})')
})
