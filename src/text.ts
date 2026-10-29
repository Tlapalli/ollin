import { Position, Sprite } from './components'
import type { Entity, World } from './ecs'

/** A font rendered into a spritesheet: frame `i` is the character with code `32 + i`. See `renderer.loadFont`. */
export interface Font {
  texture: number
  /** Pixel size the glyphs were rendered at. */
  size: number
  cellWidth: number
  cellHeight: number
  lineHeight: number
  /** Horizontal advance of each character, at `size`. */
  advances: number[]
}

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

export interface Text {
  /** One sprite entity per visible character. */
  readonly entities: Entity[]
  readonly value: string
  /** Width of the widest line, in pixels. */
  readonly width: number
  /** Replaces the text, keeping position and style. */
  set(value: string): void
}

/**
 * Spawns a line (or lines, with `\n`) of text as one sprite per character, so text batches, sorts and
 * fades like any other sprite. Put it on a `renderer.screen` layer for HUDs.
 * ponytail: ASCII only and no kerning; characters outside 32–126 draw as `?`. Add an atlas with a glyph map for Unicode.
 */
export function spawnText(world: World, font: Font, value: string, options: TextOptions = {}): Text {
  const { x = 0, y = 0, z = 0, size = font.size, tint = 0xffffff, alpha = 1, align = 'left' } = options
  const scale = size / font.size
  const w = font.cellWidth * scale
  const h = font.cellHeight * scale
  const text = {
    entities: [] as Entity[],
    value: '',
    width: 0,
    set(next: string) {
      for (const e of text.entities) world.despawn(e)
      text.entities.length = 0
      text.value = next
      const lines = next.split('\n')
      const widths = lines.map((line) => [...line].reduce((sum, c) => sum + font.advances[glyph(c)] * scale, 0))
      text.width = Math.max(0, ...widths)
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

const glyph = (c: string) => {
  const code = c.charCodeAt(0)
  return code >= 32 && code <= 126 ? code - 32 : 31 // '?'
}
