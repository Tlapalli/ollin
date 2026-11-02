import { Position, Sprite } from './components'
import type { Entity, World } from './ecs'

/**
 * Characters every font gets: printable ASCII, Latin-1 (accents, ñ, ¿, ¡, ü: Spanish, Portuguese, French, German...)
 * and the macron vowels of Classical Nahuatl. Add more with `renderer.loadFont({ chars: '←→♥' })`.
 */
export const DEFAULT_CHARS =
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') +
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(0xa1 + i)).join('') +
  'āēīōūĀĒĪŌŪ'

/** A font rendered into a spritesheet, one cell per character. See `renderer.loadFont`. */
export interface Font {
  texture: number
  /** Pixel size the glyphs were rendered at. */
  size: number
  cellWidth: number
  cellHeight: number
  lineHeight: number
  /** Spritesheet frame of each character. */
  glyphs: Map<string, number>
  /** Horizontal advance of each frame, at `size`. */
  advances: number[]
}

/** Options for `spawnText`. */
export interface TextOptions {
  /** Top-left corner of the text block (or top-center / top-right with `align`). */
  x?: number
  y?: number
  z?: number
  /** Pixel size. Default: the size the font was loaded at. */
  size?: number
  /** 0xRRGGBB. Default white. */
  tint?: number
  alpha?: number
  align?: 'left' | 'center' | 'right'
}

/** Text spawned by `spawnText`: change it with `set`, restyle it with `tint` and `alpha`, remove it with `destroy`. */
export interface Text {
  /** One sprite entity per visible character. */
  readonly entities: Entity[]
  readonly value: string
  /** Width of the widest line, in pixels. */
  readonly width: number
  /** Color of every character, 0xRRGGBB. Setting it recolors the text. */
  tint: number
  /** Opacity of every character, 0–1. Setting it fades the text (blink, fade out). */
  alpha: number
  /** Replaces the text, keeping position and style. */
  set(value: string): void
}

const warned = new Set<string>()

/**
 * Spawns a line (or lines, with `\n`) of text as one sprite per character, so text batches, sorts and
 * fades like any other sprite. Put it on a `renderer.screen` layer for HUDs. Characters missing from the font draw
 * as `?` and log a warning once.
 */
// ponytail: no kerning and no combining marks beyond what NFC composes; shape text in a canvas if a game needs scripts
export function spawnText(world: World, font: Font, value: string, options: TextOptions = {}): Text {
  const { x = 0, y = 0, z = 0, size = font.size, align = 'left' } = options
  const scale = size / font.size
  const w = font.cellWidth * scale
  const h = font.cellHeight * scale
  const fallback = font.glyphs.get('?') ?? 0
  const glyph = (c: string) => {
    const frame = font.glyphs.get(c)
    if (frame !== undefined) return frame
    if (!warned.has(c)) {
      warned.add(c)
      console.warn(`Ollin: "${c}" is not in the font; add it with renderer.loadFont({ chars: '${c}' })`)
    }
    return fallback
  }
  let tint = options.tint ?? 0xffffff
  let alpha = options.alpha ?? 1
  const text: Text = {
    entities: [],
    value: '',
    width: 0,
    get tint() {
      return tint
    },
    set tint(next) {
      tint = next
      for (const e of text.entities) Sprite.tint[e] = next
    },
    get alpha() {
      return alpha
    },
    set alpha(next) {
      alpha = next
      for (const e of text.entities) Sprite.alpha[e] = next
    },
    set(next: string) {
      for (const e of text.entities) world.despawn(e)
      text.entities.length = 0
      ;(text as { value: string }).value = next
      const lines = next.normalize('NFC').split('\n')
      const widths = lines.map((line) => [...line].reduce((sum, c) => sum + font.advances[glyph(c)] * scale, 0))
      ;(text as { width: number }).width = Math.max(0, ...widths)
      lines.forEach((line, row) => {
        let cursor = x - (align === 'center' ? widths[row] / 2 : align === 'right' ? widths[row] : 0)
        for (const c of line) {
          const frame = glyph(c)
          // Glyphs are drawn 1 px into their cell, and sprites are centered on Position.
          if (c !== ' ') {
            text.entities.push(
              world.spawn(
                [Position, { x: cursor - scale + w / 2, y: y + row * font.lineHeight * scale - scale + h / 2, z }],
                [Sprite, { w, h, texture: font.texture, frame, tint, alpha }],
              ),
            )
          }
          cursor += font.advances[frame] * scale
        }
      })
    },
  }
  text.set(value)
  return text
}
