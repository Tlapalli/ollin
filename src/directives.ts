// The `.ollin` directive file: one declaration per line, compiled by the Vite plugin (`@tlapalli/ollin/vite`) into a
// module that creates the game and loads every asset. DOM-free so it is tested in Node.
//
//   #game(width: 1280, height: 720, background: #1b1b1b, pixelArt: true)
//   #texture tiles  ./art/tiles.png  (frame: 16x16)
//   #atlas   hero   ./art/hero.json
//   #sound   jump   ./sfx/jump.wav
//   #font    ui     (family: "monospace", size: 16)
//   #map     level  ./maps/level.tmj

/** A value in a directive's options: a number, a string, a boolean, a color (`#rrggbb`) or a size (`16x16`). */
export type DirectiveValue = number | string | boolean | { color: number } | { w: number; h: number }

/** One parsed line of a `.ollin` file. */
export interface Directive {
  kind: 'game' | AssetKind
  /** Asset name (a JS identifier); empty for `#game`. */
  name: string
  /** File path as written, relative to the `.ollin` file; empty when the directive takes none. */
  path: string
  options: Record<string, DirectiveValue>
  /** 1-based line, for error messages. */
  line: number
}

type AssetKind = 'texture' | 'atlas' | 'sound' | 'font' | 'map'

/** A directive error with the line it happened on. */
export class DirectiveError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`)
  }
}

// What each directive takes: a path or not, and which options.
const KINDS: Record<Directive['kind'], { path: boolean; options: string[] }> = {
  game: { path: false, options: ['width', 'height', 'background', 'canvas', 'renderer', 'pixelArt', 'devtools', 'capacity'] },
  texture: { path: true, options: ['frame', 'margin', 'spacing', 'filter'] },
  atlas: { path: true, options: ['filter'] },
  sound: { path: true, options: [] },
  font: { path: false, options: ['family', 'size', 'weight', 'filter', 'chars'] },
  map: { path: true, options: ['z'] },
}

const LINE = /^#(\w+)(?:\s+([A-Za-z_$][\w$]*))?(?:\s+([^\s(]+))?\s*(?:\((.*)\))?\s*$/

/** Parses a `.ollin` file. Blank lines and `//` comments are skipped; anything else must be a directive. */
export function parseDirectives(source: string): Directive[] {
  const directives: Directive[] = []
  const names = new Set<string>()
  source.split('\n').forEach((raw, i) => {
    const line = i + 1
    const text = raw.trim()
    if (!text || text.startsWith('//')) return
    const m = LINE.exec(text)
    if (!m) throw new DirectiveError(`expected a directive like "#texture name ./file.png", got "${text}"`, line)
    const [, kind, name = '', path = '', args] = m
    const spec = KINDS[kind as Directive['kind']]
    if (!spec) throw new DirectiveError(`unknown directive #${kind}; use one of ${Object.keys(KINDS).map((k) => '#' + k).join(', ')}`, line)
    if (kind === 'game') {
      if (name || path) throw new DirectiveError('#game takes only options: #game(width: 1280, height: 720)', line)
      if (directives.some((d) => d.kind === 'game')) throw new DirectiveError('#game appears twice', line)
    } else {
      if (!name) throw new DirectiveError(`#${kind} needs a name: #${kind} hero ${spec.path ? './hero.png' : '(…)'}`, line)
      if (names.has(name)) throw new DirectiveError(`"${name}" is declared twice`, line)
      names.add(name)
      if (spec.path && !path) throw new DirectiveError(`#${kind} ${name} needs a file path`, line)
      if (!spec.path && path) throw new DirectiveError(`#${kind} takes no file path, only options`, line)
    }
    const options = parseOptions(args ?? '', line)
    for (const key of Object.keys(options))
      if (!spec.options.includes(key)) throw new DirectiveError(`#${kind} has no option "${key}"; it takes ${spec.options.join(', ') || 'none'}`, line)
    directives.push({ kind: kind as Directive['kind'], name, path, options, line })
  })
  return directives
}

function parseOptions(args: string, line: number) {
  const options: Record<string, DirectiveValue> = {}
  // Commas inside quotes belong to the string.
  for (const part of args.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
    if (!part.trim()) continue
    const m = /^\s*(\w+)\s*:\s*(.+?)\s*$/.exec(part)
    if (!m) throw new DirectiveError(`expected "key: value", got "${part.trim()}"`, line)
    options[m[1]] = parseValue(m[2], line)
  }
  return options
}

function parseValue(text: string, line: number): DirectiveValue {
  if (/^"[^"]*"$/.test(text)) return text.slice(1, -1)
  if (text === 'true' || text === 'false') return text === 'true'
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return { color: parseInt(text.slice(1), 16) }
  const size = /^(\d+)x(\d+)$/.exec(text)
  if (size) return { w: Number(size[1]), h: Number(size[2]) }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (/^[A-Za-z][\w-]*$/.test(text)) return text // bare words: webgl2, nearest, bold
  throw new DirectiveError(`can't read the value "${text}"; quote strings, write colors as #rrggbb and sizes as 16x16`, line)
}

/**
 * Generates the module for a `.ollin` file. `runtime` is where the engine is imported from. Relative asset paths are
 * imported with `?url`, so the bundler copies and hashes them; paths starting with `/` are files in the public folder,
 * used as they are (needed for Tiled maps, whose tileset images the bundler cannot see). `atlasImages` gives the
 * image path of each relative atlas by name, read from its JSON at build time, so the bundler copies it too.
 */
export function compileDirectives(directives: Directive[], runtime = '@tlapalli/ollin', atlasImages: Record<string, string> = {}): string {
  const game = directives.find((d) => d.kind === 'game')?.options ?? {}
  const assets = directives.filter((d) => d.kind !== 'game')
  const pixel = game.pixelArt === true
  const out: string[] = []
  const has = (kind: AssetKind) => assets.some((d) => d.kind === kind)
  const imports = ['createGame', 'input', 'Renderer', game.renderer === 'webgpu' ? 'webgpu' : 'webgl2']
  if (has('sound')) imports.push('audio', 'Audio')
  if (game.devtools === true) imports.push('devtools')
  if (has('map')) imports.push('fetchTilemap')
  out.push(`import { ${imports.join(', ')} } from ${JSON.stringify(runtime)}`)
  const url = (d: Directive, i: number) => (d.path.startsWith('/') ? JSON.stringify(d.path) : `url${i}`)
  assets.forEach((d, i) => {
    if (d.path && !d.path.startsWith('/')) out.push(`import url${i} from ${JSON.stringify(withUrl(d.path))}`)
    if (atlasImages[d.name]) out.push(`import image${i} from ${JSON.stringify(withUrl(atlasImages[d.name]))}`)
  })
  out.push('')
  out.push(`const canvas = document.querySelector(${JSON.stringify(typeof game.canvas === 'string' ? game.canvas : 'canvas')})`)
  out.push(`if (!canvas) throw new Error('No canvas for the game: add <canvas> to the page or set #game(canvas: "#id")')`)
  if (typeof game.width === 'number') out.push(`canvas.width = ${game.width}`)
  if (typeof game.height === 'number') out.push(`canvas.height = ${game.height}`)
  if (pixel) out.push(`canvas.style.imageRendering = 'pixelated'`)
  const bg = game.background
  const background = typeof bg === 'object' && 'color' in bg ? `{ background: [${[16, 8, 0].map((s) => +(((bg.color >> s) & 255) / 255).toFixed(4)).join(', ')}, 1] }` : ''
  const plugins = [`${game.renderer === 'webgpu' ? 'webgpu' : 'webgl2'}(${background})`, 'input()']
  if (has('sound')) plugins.push('audio()') // only with sounds: an AudioContext warns until the first tap
  if (game.devtools === true) plugins.push('devtools()')
  const capacity = typeof game.capacity === 'number' ? `, capacity: ${game.capacity}` : ''
  out.push(`export const game = await createGame({ canvas, plugins: [${plugins.join(', ')}]${capacity} })`)
  out.push('const renderer = game.get(Renderer)')
  const loads = assets.map((d, i) => {
    const o = d.options
    const filter = o.filter ?? (pixel ? 'nearest' : undefined)
    switch (d.kind) {
      case 'texture': {
        const frame = o.frame as { w: number; h: number } | undefined
        return `renderer.loadTexture(${url(d, i)}, ${js({ frameWidth: frame?.w, frameHeight: frame?.h, margin: o.margin, spacing: o.spacing, filter })})`
      }
      case 'atlas': {
        const fields = [filter && `"filter":${JSON.stringify(filter)}`, atlasImages[d.name] && `"image":image${i}`].filter(Boolean)
        return `renderer.loadAtlas(${url(d, i)}, {${fields.join(',')}})`
      }
      case 'sound':
        return `game.get(Audio).load({ sound: ${url(d, i)} }).then((s) => s.sound)`
      case 'font':
        return `renderer.loadFont(${js({ family: o.family, size: o.size, weight: o.weight, chars: o.chars, filter })})`
      case 'map':
        return `fetchTilemap(game, ${url(d, i)}${o.z === undefined ? '' : `, { z: ${o.z} }`})`
    }
  })
  out.push(`const loaded = await Promise.all([${loads.join(', ')}])`)
  out.push(`export const assets = { ${assets.map((d, i) => `${d.name}: loaded[${i}]`).join(', ')} }`)
  return out.join('\n') + '\n'
}

/** Generates the `.d.ts` next to a `.ollin` file, so editors and `tsc` know `assets.hero` is an `Atlas`. */
export function declareDirectives(directives: Directive[], runtime = '@tlapalli/ollin'): string {
  const types: Record<AssetKind, string> = { texture: 'number', atlas: 'Atlas', sound: 'AudioBuffer', font: 'Font', map: 'TilemapAsset' }
  const assets = directives.filter((d) => d.kind !== 'game')
  return [
    '// Generated from the .ollin file next to it by @tlapalli/ollin/vite. Do not edit.',
    `import type { Atlas, Font, Game, TilemapAsset } from ${JSON.stringify(runtime)}`,
    'export declare const game: Game',
    `export declare const assets: { ${assets.map((d) => `${d.name}: ${types[d.kind as AssetKind]}`).join('; ')} }`,
    '',
  ].join('\n')
}

const withUrl = (path: string) => (path.startsWith('.') ? path : './' + path) + '?url'

/** Object literal without undefined fields. */
const js = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)))
