/** One frame of a packed spritesheet, in pixels. */
export interface AtlasFrame {
  name: string
  /** Where the frame's pixels sit in the image. */
  x: number
  y: number
  w: number
  h: number
  /** Size of the frame before trimming, and where the trimmed pixels sit inside it. */
  sourceW: number
  sourceH: number
  offsetX: number
  offsetY: number
  /** Milliseconds the frame shows in animations (Aseprite), or undefined. */
  duration?: number
}

/** Frames to play for an Aseprite tag, ready for the `Animation` component: `[Animation, atlas.tags.run]`. */
export interface AtlasTag {
  start: number
  count: number
  fps: number
}

/** A spritesheet JSON (Aseprite or TexturePacker, array or hash), parsed but not loaded. */
export interface AtlasData {
  /** Image file, relative to the JSON. */
  image: string
  frames: AtlasFrame[]
  tags: Record<string, AtlasTag>
}

type Rect = { x: number; y: number; w: number; h: number }
type JsonFrame = { filename?: string; frame: Rect; rotated?: boolean; trimmed?: boolean; spriteSourceSize?: Rect; sourceSize?: { w: number; h: number }; duration?: number }
type Json = {
  frames: JsonFrame[] | Record<string, JsonFrame>
  meta: { image: string; frameTags?: { name: string; from: number; to: number; direction?: string }[] }
}

let warned = false

/**
 * Parses the JSON that Aseprite (File > Export Sprite Sheet, "JSON Data") and TexturePacker ("JSON (Hash)" or
 * "JSON (Array)") write. Frame indices follow the file's order, which is what `Sprite.frame` and tags use.
 */
export function parseAtlas(json: unknown): AtlasData {
  const { frames, meta } = json as Json
  if (!frames || !meta?.image) throw new Error('Not a spritesheet JSON: expected "frames" and "meta.image"')
  const list = Array.isArray(frames) ? frames : Object.entries(frames).map(([filename, f]) => ({ ...f, filename }))
  const parsed = list.map((f, i): AtlasFrame => {
    // ponytail: rotated frames (TexturePacker "allow rotation") draw sideways; export without rotation, or add a rotated flag to the frame table
    if (f.rotated && !warned) {
      warned = true
      console.warn('Rotated atlas frames are not supported; export the spritesheet without rotation')
    }
    const trim = f.spriteSourceSize ?? { ...f.frame, x: 0, y: 0 }
    const source = f.sourceSize ?? f.frame
    return {
      name: f.filename ?? String(i),
      ...f.frame,
      sourceW: source.w,
      sourceH: source.h,
      offsetX: trim.x,
      offsetY: trim.y,
      duration: f.duration,
    }
  })
  const tags: Record<string, AtlasTag> = {}
  // ponytail: tags play forward; Aseprite "reverse" and "pingpong" directions are ignored
  for (const { name, from, to } of meta.frameTags ?? []) {
    const count = to - from + 1
    const ms = parsed.slice(from, to + 1).reduce((sum, f) => sum + (f.duration ?? 100), 0)
    tags[name] = { start: from, count, fps: (count * 1000) / ms }
  }
  return { image: meta.image, frames: parsed, tags }
}
