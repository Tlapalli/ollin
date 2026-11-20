/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { compileDirectives, declareDirectives, DirectiveError, parseDirectives } from './directives'

/** Options for the `ollin()` Vite plugin. */
export interface OllinPluginOptions {
  /** Where generated code imports the engine from. Default `@tlapalli/ollin`. */
  runtime?: string
}

// The subset of Vite's plugin API this uses, so the engine does not depend on Vite's types.
interface TransformContext {
  warn(message: string): void
  error(error: { message: string; id?: string; loc?: { file?: string; line: number; column: number } }): never
  addWatchFile(id: string): void
}

/**
 * Vite plugin that compiles `.ollin` directive files: `import { game, assets } from './game.ollin'` creates the game
 * and loads every declared asset. It checks that each file exists (with the line of the directive when it does not)
 * and writes `game.ollin.d.ts` next to the file so editors and `tsc` know the types of `assets`.
 * `plugins: [ollin()]` in `vite.config.ts`.
 */
export function ollin(options: OllinPluginOptions = {}) {
  const runtime = options.runtime ?? '@tlapalli/ollin'
  let publicDir = ''
  let building = false
  return {
    name: 'ollin',
    enforce: 'pre' as const,
    configResolved(config: { publicDir: string; command: string }) {
      publicDir = config.publicDir
      building = config.command === 'build'
    },
    transform(this: TransformContext, source: string, id: string) {
      const file = id.split('?')[0]
      if (!file.endsWith('.ollin')) return
      try {
        const directives = parseDirectives(source)
        const atlasImages: Record<string, string> = {}
        const fail = (line: number, message: string): never => this.error({ message: `${file}:${line}: ${message}`, id: file, loc: { file, line, column: 0 } })
        for (const d of directives) {
          if (!d.path) continue
          // Paths starting with / are public files (served and copied as they are).
          const path = d.path.startsWith('/') ? join(publicDir, d.path) : resolve(dirname(file), d.path)
          this.addWatchFile(path)
          if (!existsSync(path)) fail(d.line, `#${d.kind} ${d.name}: file not found: ${d.path}${d.path.startsWith('/') ? ` (public paths are looked up in ${publicDir})` : ''}`)
          if (d.kind === 'atlas' && !d.path.startsWith('/')) {
            // The atlas image is named inside the JSON; import it too so the bundler copies it.
            const image = (JSON.parse(readFileSync(path, 'utf8')) as { meta?: { image?: string } }).meta?.image
            if (!image) fail(d.line, `#atlas ${d.name}: ${d.path} has no meta.image`)
            const imagePath = posix.join(posix.dirname(d.path), image!)
            if (!existsSync(resolve(dirname(file), imagePath))) fail(d.line, `#atlas ${d.name}: image not found: ${imagePath}`)
            atlasImages[d.name] = imagePath
          }
          // ponytail: tileset images inside a bundled map are not copied; maps go in public/ for builds. Parse the map and import its tilesets if that gets annoying
          if (building && d.kind === 'map' && !d.path.startsWith('/'))
            this.warn(`${file}:${d.line}: #map ${d.name}: the bundler cannot see the tileset images inside ${d.path}; put the map and its images in public/ and write /${posix.basename(d.path)}`)
        }
        // Only rewrite the declarations when they change, so watchers do not loop.
        const types = declareDirectives(directives, runtime)
        const dts = file + '.d.ts'
        if (!existsSync(dts) || readFileSync(dts, 'utf8') !== types) writeFileSync(dts, types)
        return { code: compileDirectives(directives, runtime, atlasImages), map: null }
      } catch (e) {
        if (e instanceof DirectiveError) this.error({ message: `${file}:${e.line}: ${e.message.replace(/^line \d+: /, '')}`, id: file, loc: { file, line: e.line, column: 0 } })
        throw e
      }
    },
  }
}
