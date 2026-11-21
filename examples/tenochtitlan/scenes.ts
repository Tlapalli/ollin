import {
  after,
  Animation,
  attach,
  Audio,
  Camera,
  Debug,
  defineComponent,
  drawnPosition,
  ease,
  every,
  f32,
  Input,
  Interpolate,
  NineSlice,
  Position,
  Renderer,
  spawnText,
  Sprite,
  Tiling,
  tween,
  u8,
  type Entity,
  type Game,
  type Scene,
  type TextOptions,
  type TiledObject,
  type TilemapAsset,
} from '../../src'
import { assets } from './game.ollin'

// Tenochtitlan, 1519-1520: a side-scrolling action platformer seen from the Mexica side. A (fictional) eagle warrior
// fights from the arrival of the strangers to the night the city drove them out along the Tlacopan causeway.

// --- Layers ---------------------------------------------------------------------------------------------------------------
// Parallax behind the map; the map's tile layers take z 0-5 (back, decor, solid, ledges, hazards, things).
const SKY = -5
const VOLCANOES = -4
const LAKE = -3
const CITY = -2
const ITEMS = 6
const ACTORS = 7
const FX = 8 // additive: fire, glows, sparks
const RAIN = 9
const FLASH = 98 // additive, screen: lightning
const PANELS = 99
const HUD = 100

const VIEW_H = 240 // the map is 15 tiles tall; the camera always shows all of it
const WATER_Y = 212 // top of the water in the breaches (and of the canoes)
const MAX_HP = 8
const GRAVITY = 900
const RUN = 90
const JUMP = 330
const MAX_FALL = 420

// --- Chapters ---------------------------------------------------------------------------------------------------------------
interface Chapter {
  name: string
  date: string
  story: string
  map: TilemapAsset
  /** Multiplies the art: daylight is white; dusk and night darken and cool it. */
  light: { sky: number; far: number; city: number; tiles: number }
  rain?: boolean
}

const chapters: Chapter[] = [
  {
    name: 'The arrival',
    date: '8 November 1519',
    story:
      'Tenochtitlan rises from the waters of Lake Texcoco, the greatest city of the Mexica. Today strangers from across the sea march in along the causeway of Iztapalapa with horses, steel and thousands of Tlaxcaltec allies. The huey tlahtoani Motecuhzoma receives them as guests. In the warriors’ yard, you keep training.',
    map: assets.arrival,
    light: { sky: 0xffffff, far: 0xffffff, city: 0xffffff, tiles: 0xffffff },
  },
  {
    name: 'Tóxcatl',
    date: 'May 1520',
    story:
      'Motecuhzoma is held prisoner in the palace of Axayácatl. While Hernán Cortés is away on the coast, the city celebrates Tóxcatl, the great festival of Tezcatlipoca, in the sacred precinct. Pedro de Alvarado’s soldiers close the gates and fall on the unarmed dancers. Fight your way out.',
    map: assets.toxcatl,
    light: { sky: 0xffffff, far: 0xf0f0ff, city: 0xffffff, tiles: 0xffffff },
  },
  {
    name: 'The uprising',
    date: 'June 1520',
    story:
      'Tenochtitlan rises. The invaders and their allies are besieged in the palace of Axayácatl; Cortés returns with more men and is trapped too. Motecuhzoma dies in these days, and Cuitláhuac leads the city. Take the rooftops and stop the captain who rides out to break the siege.',
    map: assets.uprising,
    light: { sky: 0xf0a878, far: 0xc89a98, city: 0xe8c0a8, tiles: 0xf0d8c8 },
  },
  {
    name: 'The night',
    date: '30 June 1520',
    story:
      'Short of food and water, the invaders try to slip out at night along the causeway of Tlacopan, loaded with gold. A woman drawing water sees them and raises the alarm. The bridges are down and the canals fill with canoes. Chase them to the Toltec canal.',
    map: assets.night,
    light: { sky: 0x2a3458, far: 0x404a70, city: 0x50587a, tiles: 0x8a90b0 },
    rain: true,
  },
]

const EPILOGUE =
  'Before dawn on 1 July 1520 the invaders who survived had fled the city, leaving their gold and hundreds of their own in the canals. The Mexica had won. The Spaniards called it la Noche Triste, the sad night. A year later they came back with a larger army of allies, after smallpox had swept the valley, and Tenochtitlan fell in August 1521 after a long siege. Its people remember the night they drove the conquerors out.'

interface Run {
  chapter: number
  lives: number
  score: number
  darts: number
  /** Where the player respawns: the start, or the last checkpoint touched. */
  checkpoint?: { x: number; y: number }
}

// --- Components -------------------------------------------------------------------------------------------------------------
/** Anything that moves under gravity and collides with the map: hitbox w x h centered on x, bottom at y + foot. */
const Body = defineComponent({ vx: f32, vy: f32, w: f32, h: f32, foot: f32, grounded: u8 })
const DUMMY = 0
const SOLDIER = 1
const CROSSBOW = 2
const DOG = 3
const RUNNER = 4
const Foe = defineComponent({ kind: u8, hp: u8, dir: f32, flash: f32, awake: u8, t: f32, cool: f32 })
const DART = 0
const BOLT = 1
const Shot = defineComponent({ kind: u8, vx: f32, vy: f32 })
const Basket = defineComponent({ drop: u8 })
const HEART = 1
const CACAO = 2
const DARTS = 3
const GOLD = 4
const Pickup = defineComponent({ kind: u8 })
const Canoe = defineComponent({ x0: f32, x1: f32, dir: f32, dx: f32 })

const confirmed = (input: Input) => ['Space', 'Enter', 'Pointer', 'Button0', 'Button9'].some((key) => input.pressed.has(key))
const prop = (o: TiledObject, name: string) => o.properties[name]

/** Per-scene setup shared by every screen: layers, UI helpers, camera and parallax for a chapter's look. */
function stage(game: Game, chapter: Chapter) {
  const { world, canvas } = game
  const renderer = game.get(Renderer)
  for (const z of [PANELS, HUD, FLASH]) renderer.screen.add(z)
  for (const z of [FX, FLASH]) renderer.additive.add(z)
  const ui = canvas.height / 360
  const text = (value: string, options: TextOptions) =>
    spawnText(world, assets.ui, value, {
      z: HUD,
      align: 'center',
      ...options,
      x: (options.x ?? 0) * ui,
      y: (options.y ?? 0) * ui,
      size: (options.size ?? 12) * ui,
      maxWidth: options.maxWidth && options.maxWidth * ui,
    })
  /** A codex-style panel (NineSlice) in UI pixels. */
  const panel = (x: number, y: number, w: number, h: number, alpha = 0.95) =>
    world.spawn(
      [Position, { x: (x + w / 2) * ui, y: (y + h / 2) * ui, z: PANELS }],
      [Sprite, { w: w * ui, h: h * ui, texture: assets.panel, alpha }],
      [NineSlice, { left: 8, right: 8, top: 8, bottom: 8, scale: ui }],
    )
  /** A solid band in UI pixels (a Sprite without a texture is a rectangle in its tint). */
  const rect = (x: number, y: number, w: number, h: number, tint: number, alpha = 1, z = PANELS) =>
    world.spawn([Position, { x: (x + w / 2) * ui, y: (y + h / 2) * ui, z }], [Sprite, { w: w * ui, h: h * ui, tint, alpha }])

  // Parallax: one Tiling sprite per layer, kept on the camera; its pattern scrolls slower than the world.
  const camera = game.get(Camera)
  const layers = [
    { texture: assets.sky, z: SKY, speed: 0.04, top: 0, h: 240, tint: chapter.light.sky },
    { texture: assets.volcanoes, z: VOLCANOES, speed: 0.12, top: 40, h: 120, tint: chapter.light.far },
    { texture: assets.lake, z: LAKE, speed: 0.25, top: 152, h: 48, tint: chapter.light.far },
    { texture: assets.city, z: CITY, speed: 0.45, top: 60, h: 140, tint: chapter.light.city },
  ].map((l) => ({ ...l, e: world.spawn([Position, { y: l.top + l.h / 2, z: l.z }], [Sprite, { h: l.h, texture: l.texture, tint: l.tint }], [Tiling]) }))
  let shake = 0
  let width = 0
  const halfView = () => {
    camera.zoom = canvas.height / VIEW_H
    return camera.width / 2 / camera.zoom
  }
  /** Follows a target horizontally inside [0, width]; drives the parallax. */
  const follow = (target: () => number, mapWidth: number) => {
    width = mapWidth
    game.system((dt) => {
      const hw = halfView()
      const goal = Math.min(Math.max(target(), hw), width - hw)
      camera.x += (goal - camera.x) * Math.min(1, dt * 8)
      camera.x = Math.min(Math.max(camera.x, hw), width - hw)
      shake = Math.max(0, shake - dt * 30)
      camera.y = VIEW_H / 2 + (Math.random() - 0.5) * shake
      for (const l of layers) {
        Position.x[l.e] = camera.x
        Sprite.w[l.e] = hw * 2 + 2
        Tiling.x[l.e] = -camera.x * l.speed
      }
    })
  }
  const snap = (x: number) => {
    const hw = halfView()
    camera.x = Math.min(Math.max(x, hw), width - hw)
    camera.y = VIEW_H / 2
  }
  return { renderer, ui, text, panel, rect, follow, snap, shakeCamera: (amount: number) => (shake = Math.max(shake, amount)) }
}

/** The intro of a chapter: its parallax with a narration panel. */
const card =
  (run: Run): Scene =>
  (game) => {
    const chapter = chapters[run.chapter]
    const { text, panel, follow, snap } = stage(game, chapter)
    const input = game.get(Input)
    let t = 0
    game.system((dt) => (t += dt))
    follow(() => 300 + t * 20, 100000)
    snap(300)
    panel(110, 60, 420, 220)
    text(chapter.date.toUpperCase(), { x: 320, y: 82, size: 10, tint: 0x7a1f1b })
    text(chapter.name, { x: 320, y: 98, size: 24, tint: 0xb5302a })
    text(chapter.story, { x: 136, y: 138, size: 10, tint: 0x141016, align: 'left', maxWidth: 368 })
    const prompt = text('press enter or tap to continue', { x: 320, y: 300, size: 11, tint: 0xf3e6c9 })
    every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))
    game.get(Audio).play(assets.conch)
    let ready = false
    after(game, 0.6, () => (ready = true))
    game.system(() => {
      if (ready && confirmed(input)) void game.scene(level(run))
    })
  }

export const title: Scene = (game) => {
  const { text, rect, follow, snap } = stage(game, chapters[0])
  const input = game.get(Input)
  let t = 0
  game.system((dt) => (t += dt))
  follow(() => 300 + t * 25, 100000)
  snap(300)
  rect(0, 70, 640, 116, 0x0b0a0c, 0.6)
  text('TENOCHTITLAN', { x: 320, y: 82, size: 48, tint: 0xf3e6c9 })
  text('1519 – 1520', { x: 320, y: 140, size: 14, tint: 0xf2c14e })
  text('from the arrival of the strangers to the night the city drove them out', { x: 320, y: 162, size: 10, tint: 0xf3e6c9 })
  rect(0, 268, 640, 62, 0x0b0a0c, 0.6)
  text('move: arrows / A D · jump: Z K space · strike: X J · dart: C L · gamepad and touch too', { x: 320, y: 278, size: 9, tint: 0xf3e6c9, alpha: 0.85 })
  const prompt = text('press enter or tap to begin', { x: 320, y: 302, size: 12, tint: 0x1f9e9a })
  every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))
  game.system(() => {
    if (!confirmed(input)) return
    game.get(Audio).play(assets.start)
    void game.scene(card({ chapter: 0, lives: 3, score: 0, darts: 5 }))
  })
}

/** One chapter's level. */
const level =
  (run: Run): Scene =>
  (game) => {
    const chapter = chapters[run.chapter]
    const { renderer, ui, text, panel, rect, follow, snap, shakeCamera } = stage(game, chapter)
    const { world, canvas } = game
    const input = game.get(Input)
    const sound = game.get(Audio)
    const debug = game.get(Debug)
    const map = chapter.map.spawn()
    for (const layer of Object.values(map.layers)) for (const e of layer) Sprite.tint[e] = chapter.light.tiles

    let gateX = Infinity
    let gateClosed = false
    const solidAt = (px: number, py: number) => map.tileAt('solid', px, py) >= 0 || (gateClosed && px >= gateX && px < gateX + 16)
    const ledgeAt = (px: number, py: number) => map.tileAt('ledges', px, py) >= 0
    const waterAt = (px: number, py: number) => map.tileAt('hazards', px, py) >= 0

    // --- Things from the map --------------------------------------------------------------------------------------------
    const things = (type: string) => map.objects.filter((o) => o.type === type)
    const start = run.checkpoint ?? things('player')[0]
    const spawnBody = (px: number, bottom: number, w: number, h: number, sprite: { w: number; h: number; texture: number; frame?: number }) =>
      world.spawn(
        [Position, { x: px, y: bottom - sprite.h / 2, z: ACTORS }],
        [Sprite, sprite],
        [Body, { w, h, foot: sprite.h / 2 }],
        [Interpolate],
        [Animation, { count: 1 }],
      )
    const player = spawnBody(start.x, start.y, 10, 22, assets.hero.sprite('hero 0'))
    for (const o of things('dummy')) world.add(spawnBody(o.x, o.y, 10, 28, { w: 16, h: 32, texture: assets.dummy }), Foe, { kind: DUMMY, hp: 2 })
    for (const o of things('soldier')) world.add(spawnBody(o.x, o.y, 12, 26, { w: 32, h: 32, texture: assets.soldier }), Foe, { kind: SOLDIER, hp: 3, dir: -1 })
    for (const o of things('runner')) world.add(spawnBody(o.x, o.y, 12, 26, { w: 32, h: 32, texture: assets.soldier }), Foe, { kind: RUNNER, hp: 2, dir: 1 })
    for (const o of things('crossbow')) world.add(spawnBody(o.x, o.y, 12, 26, { w: 32, h: 32, texture: assets.crossbow }), Foe, { kind: CROSSBOW, hp: 2, dir: -1, cool: 1 })
    for (const o of things('dog')) world.add(spawnBody(o.x, o.y, 20, 14, { w: 32, h: 24, texture: assets.dog }), Foe, { kind: DOG, hp: 1, dir: -1 })
    for (const o of things('basket')) world.spawn([Position, { x: o.x, y: o.y - 8, z: ITEMS }], [Sprite, { w: 16, h: 16, texture: assets.basket }], [Basket, { drop: Number(prop(o, 'drop') ?? 1) }])
    for (const o of things('canoe')) {
      const x0 = Number(prop(o, 'x0'))
      const x1 = Number(prop(o, 'x1'))
      world.spawn([Position, { x: x0 + 32, y: WATER_Y + 3, z: ACTORS - 0.5 }], [Sprite, { w: 64, h: 12, texture: assets.canoe, tint: chapter.light.tiles }], [Canoe, { x0: x0 + 32, x1: x1 - 32, dir: 1 }], [Interpolate])
    }
    // Torches: a post with a flame and a soft glow attached to it, both additive.
    const flame = (parent: Entity, dy: number) => {
      const fire = world.spawn([Position], [Sprite, { w: 16, h: 16, texture: assets.fire }], [Animation, { count: 2, fps: 8 }])
      attach(world, fire, parent, { y: dy, z: FX - Position.z[parent] })
      const glow = world.spawn([Position], [Sprite, { w: 72, h: 72, texture: assets.spark, tint: 0xf28c28, alpha: 0.35 }])
      attach(world, glow, parent, { y: dy, z: FX - Position.z[parent] })
    }
    for (const o of things('torch')) flame(world.spawn([Position, { x: o.x, y: o.y - 8, z: ITEMS }], [Sprite, { w: 16, h: 16, texture: assets.tiles, frame: 10, tint: chapter.light.tiles }]), -10)
    for (const e of map.layers.decor ?? []) if (Sprite.frame[e] === 10) flame(e, -10)
    const checkpoints = things('checkpoint')
    const hints = things('hint')
    const exit = things('exit')[0]
    const gate = things('gate')[0]
    if (gate) gateX = gate.x - 8
    const captainSpot = things('captain')[0]

    const foes = world.query(Foe)
    const shots = world.query(Shot)
    const baskets = world.query(Basket)
    const pickups = world.query(Pickup)
    const canoes = world.query(Canoe)

    // --- HUD --------------------------------------------------------------------------------------------------------------
    rect(0, 0, 640, 24, 0x0b0a0c, 0.7)
    let hp = MAX_HP
    const hearts = Array.from({ length: MAX_HP / 2 }, (_, i) =>
      world.spawn([Position, { x: (14 + i * 14) * ui, y: 12 * ui, z: HUD }], [Sprite, { w: 12 * ui, h: 12 * ui, texture: assets.heart }]),
    )
    const showHp = () => hearts.forEach((e, i) => (Sprite.alpha[e] = hp >= (i + 1) * 2 ? 1 : hp === i * 2 + 1 ? 0.55 : 0.15))
    showHp()
    world.spawn([Position, { x: 86 * ui, y: 12 * ui, z: HUD }], [Sprite, { w: 16 * ui, h: 5 * ui, texture: assets.dart }])
    const dartsText = text('', { x: 98, y: 6, size: 10, tint: 0xf3e6c9, align: 'left' })
    const showDarts = () => dartsText.set(`×${run.darts}`)
    showDarts()
    text(`${chapter.name} · lives ${run.lives}`, { x: 320, y: 6, size: 10, tint: 0xf3e6c9 })
    const score = text('', { x: 630, y: 6, size: 10, tint: 0xf2c14e, align: 'right' })
    const addScore = (n: number) => score.set(`${(run.score += n)}`)
    addScore(0)
    const banner = (value: string, tint = 0xf2c14e, size = 18) => {
      const t = text(value, { x: 320, y: 110, size, tint })
      after(game, 1.8, () => t.entities.forEach((e) => tween(game, e, Sprite, { alpha: 0 }, { duration: 0.6, onDone: () => world.despawn(e) })))
    }
    // Hints (chapter 1): a narration panel at the bottom while the player is near one.
    let hintPanel = -1
    let hintText: ReturnType<typeof text> | undefined
    let shownHint: TiledObject | undefined
    const showHint = (h: TiledObject | undefined) => {
      if (h === shownHint) return
      shownHint = h
      if (hintPanel >= 0) world.despawn(hintPanel)
      hintText?.set('')
      hintPanel = -1
      if (!h) return
      hintPanel = panel(150, 292, 340, 50)
      if (!hintText) hintText = text('', { x: 320, y: 304, size: 10, tint: 0x141016, maxWidth: 312 })
      hintText.set(String(prop(h, 'text')))
    }

    follow(() => drawnPosition(game, player).x, map.width)
    snap(start.x)

    // --- Input: sampled every frame in update, consumed by the fixed-step physics ------------------------------------------
    let left = false
    let right = false
    let down = false
    let jumpHeld = false
    let jumpBuffer = 0
    let strikeBuffer = 0
    let throwBuffer = 0
    let hitboxes = false
    game.system((dt) => {
      const { keys, pressed, pointers } = input
      const pad = input.gamepads.find((p) => p)
      const button = (i: number) => !!pad?.buttons[i]?.pressed
      const stick = pad?.axes[0] ?? 0
      const touches = [...pointers.values()]
      const touch = (fx0: number, fx1: number, fy0: number, fy1: number) =>
        touches.some((p) => p.x >= fx0 * canvas.width && p.x < fx1 * canvas.width && p.y >= fy0 * canvas.height && p.y < fy1 * canvas.height)
      left = keys.has('ArrowLeft') || keys.has('KeyA') || button(14) || stick < -0.4 || touch(0, 1 / 3, 0.5, 1)
      right = keys.has('ArrowRight') || keys.has('KeyD') || button(15) || stick > 0.4 || touch(2 / 3, 1, 0.5, 1)
      down = keys.has('ArrowDown') || keys.has('KeyS') || button(13) || (pad?.axes[1] ?? 0) > 0.5
      jumpHeld = keys.has('KeyZ') || keys.has('KeyK') || keys.has('Space') || keys.has('ArrowUp') || button(0) || touch(0, 1, 0, 0.5)
      if (['KeyZ', 'KeyK', 'Space', 'ArrowUp', 'Button0'].some((k) => pressed.has(k))) jumpBuffer = 0.12
      if (['KeyX', 'KeyJ', 'Button2'].some((k) => pressed.has(k))) strikeBuffer = 0.12
      if (['KeyC', 'KeyL', 'Button1', 'Button3'].some((k) => pressed.has(k))) throwBuffer = 0.12
      if (pressed.has('Pointer') && touch(1 / 3, 2 / 3, 0.5, 1)) strikeBuffer = 0.12
      if (pressed.has('Pointer') && touch(0, 1, 0, 0.5)) jumpBuffer = 0.12
      if (pressed.has('F2')) hitboxes = !hitboxes
      jumpBuffer -= dt
      strikeBuffer -= dt
      throwBuffer -= dt
    })

    // --- Physics -----------------------------------------------------------------------------------------------------------
    /** The canoe under a point, if its top lies between two heights. */
    const canoeAt = (px: number, py0: number, py1: number) => {
      for (const c of canoes.entities) if (Math.abs(px - Position.x[c]) < 30 && py0 <= WATER_Y + 1 && py1 >= WATER_Y - 1) return c
      return -1
    }
    const riding = new Map<Entity, Entity>()
    /** Moves a body one axis at a time against solid tiles; ledges and canoes only stop it from above. */
    const step = (e: Entity, dt: number, dropThrough: boolean) => {
      const { x, y } = Position
      const hw = Body.w[e] / 2
      const canoe = riding.get(e)
      if (canoe !== undefined && world.has(canoe, Canoe)) x[e] += Canoe.dx[canoe]
      Body.vy[e] = Math.min(Body.vy[e] + GRAVITY * dt, MAX_FALL)
      const nx = x[e] + Body.vx[e] * dt
      const top = y[e] + Body.foot[e] - Body.h[e] + 1
      const bottom = y[e] + Body.foot[e] - 1
      const edge = Body.vx[e] > 0 ? nx + hw : nx - hw
      if (Body.vx[e] && (solidAt(edge, top) || solidAt(edge, bottom) || solidAt(edge, (top + bottom) / 2))) {
        x[e] = Body.vx[e] > 0 ? Math.floor(edge / 16) * 16 - hw - 0.01 : Math.ceil(edge / 16) * 16 + hw + 0.01
        Body.vx[e] = 0
      } else x[e] = nx
      const feet = y[e] + Body.foot[e]
      const ny = y[e] + Body.vy[e] * dt
      const nfeet = ny + Body.foot[e]
      Body.grounded[e] = 0
      riding.delete(e)
      const under = (py: number) => solidAt(x[e] - hw + 1, py) || solidAt(x[e] + hw - 1, py)
      const onLedge = (py: number) => !dropThrough && (ledgeAt(x[e] - hw + 1, py) || ledgeAt(x[e] + hw - 1, py))
      const boat = Body.vy[e] >= 0 ? canoeAt(x[e], feet - 1, nfeet) : -1
      if (boat >= 0) {
        y[e] = WATER_Y - Body.foot[e]
        Body.vy[e] = 0
        Body.grounded[e] = 1
        riding.set(e, boat)
      } else if (Body.vy[e] >= 0 && (under(nfeet) || (onLedge(nfeet) && Math.floor(feet / 16) < Math.floor(nfeet / 16) + (feet % 16 === 0 ? 1 : 0)))) {
        y[e] = Math.floor(nfeet / 16) * 16 - Body.foot[e]
        Body.vy[e] = 0
        Body.grounded[e] = 1
      } else if (Body.vy[e] < 0 && (solidAt(x[e] - hw + 1, ny + Body.foot[e] - Body.h[e]) || solidAt(x[e] + hw - 1, ny + Body.foot[e] - Body.h[e]))) {
        y[e] = Math.ceil((ny + Body.foot[e] - Body.h[e]) / 16) * 16 - Body.foot[e] + Body.h[e]
        Body.vy[e] = 0
      } else y[e] = ny
    }
    /** Player hitbox (Body) against a box of w x h centered on another entity. */
    const overlapsBody = (p: Entity, e: Entity, w: number, h: number) => {
      const cy = Position.y[p] + Body.foot[p] - Body.h[p] / 2
      return Math.abs(Position.x[p] - Position.x[e]) < (Body.w[p] + w) / 2 && Math.abs(cy - Position.y[e]) < (Body.h[p] + h) / 2
    }

    // Canoes shuttle across their breach.
    game.system((dt) => {
      for (const c of canoes.entities) {
        const before = Position.x[c]
        Position.x[c] += Canoe.dir[c] * 38 * dt
        if (Position.x[c] > Canoe.x1[c] || Position.x[c] < Canoe.x0[c]) Canoe.dir[c] *= -1
        Canoe.dx[c] = Position.x[c] - before
      }
    }, 'fixed')

    // --- Player -------------------------------------------------------------------------------------------------------------
    let facing = 1
    let coyote = 0
    let attack = -1 // seconds into the current swing, -1 when not swinging
    let throwing = -1
    let stun = 0
    let mercy = 0
    let dead = false
    let done = false
    let crouching = false
    let safe = { x: start.x, y: start.y } // last solid ground, to come back to after falling in the water
    const ATTACK = 0.34
    const swingHits = new Set<Entity>()

    const hurt = (from: number, damage = 1, knock = true) => {
      if (mercy > 0 || dead || done) return
      hp = Math.max(0, hp - damage)
      showHp()
      sound.play(assets.hurt)
      shakeCamera(6)
      renderer.burst({ x: Position.x[player], y: Position.y[player], z: FX, texture: assets.spark, tint: 0xb5302a, size: 3, count: 14, speed: 90, life: 0.5 })
      if (knock) {
        Body.vx[player] = (Position.x[player] < from ? -1 : 1) * 110
        Body.vy[player] = -200
        stun = 0.35
      }
      mercy = 1.6
      attack = -1
      if (hp <= 0) die()
    }
    const die = () => {
      if (dead) return
      dead = true
      run.lives--
      tween(game, player, Sprite, { alpha: 0 }, { duration: 1.2, onDone: () => void game.scene(run.lives > 0 ? level(run) : end(false, run)) })
    }
    const finish = () => {
      if (done) return
      done = true
      run.checkpoint = undefined
      sound.play(assets.conch)
      banner(run.chapter === chapters.length - 1 ? 'the city is free' : 'onward', 0xf2c14e, 22)
      after(game, 2.5, () => {
        if (run.chapter === chapters.length - 1) void game.scene(end(true, run))
        else void game.scene(card({ ...run, chapter: run.chapter + 1 }))
      })
    }

    game.system((dt) => {
      if (dead) return
      mercy -= dt
      stun -= dt
      coyote = Body.grounded[player] ? 0.08 : coyote - dt
      const grounded = Body.grounded[player] === 1
      crouching = grounded && down && attack < 0 && stun <= 0
      if (stun <= 0 && !done) {
        const dir = Number(right) - Number(left)
        if ((attack >= 0 || throwing >= 0) && grounded) Body.vx[player] = 0
        else if ((attack < 0 && throwing < 0) || !grounded) Body.vx[player] = crouching ? 0 : dir * RUN
        if (dir && attack < 0) facing = dir
        if (jumpBuffer > 0 && coyote > 0 && attack < 0 && !(down && grounded)) {
          Body.vy[player] = -JUMP
          jumpBuffer = 0
          coyote = 0
          sound.play(assets.jump, { volume: 0.5 })
        }
        if (jumpBuffer > 0 && down && grounded) jumpBuffer = 0
        if (!jumpHeld && Body.vy[player] < -120) Body.vy[player] = -120
        if (strikeBuffer > 0 && attack < 0 && throwing < 0) {
          attack = 0
          strikeBuffer = 0
          swingHits.clear()
          sound.play(assets.swing, { volume: 0.6, rate: 0.9 + Math.random() * 0.2 })
        }
        if (throwBuffer > 0 && attack < 0 && throwing < 0 && run.darts > 0) {
          throwing = 0
          throwBuffer = 0
          run.darts--
          showDarts()
          sound.play(assets.throw, { volume: 0.7 })
          world.spawn(
            [Position, { x: Position.x[player] + facing * 12, y: Position.y[player] - 2, z: ACTORS }],
            [Sprite, { w: 16, h: 5, texture: assets.dart, flipX: facing < 0 ? 1 : 0 }],
            [Shot, { kind: DART, vx: facing * 280, vy: -20 }],
          )
        }
      } else if (done) Body.vx[player] = 0
      step(player, dt, down && jumpHeld)
      if (attack >= 0) {
        attack += dt
        if (attack > 0.08) strike()
        if (attack >= ATTACK) attack = -1
      }
      if (throwing >= 0) {
        throwing += dt
        if (throwing > 0.25) throwing = -1
      }
      const feet = Position.y[player] + Body.foot[player]
      if (Body.grounded[player] && !riding.has(player) && solidAt(Position.x[player], feet + 2)) safe = { x: Position.x[player], y: feet }
      // The water: a splash, a hit, and back to the last solid ground. Riding a canoe keeps you out of it.
      if (!riding.has(player) && waterAt(Position.x[player], feet - 4) && !done) {
        sound.play(assets.splash)
        renderer.burst({ x: Position.x[player], y: WATER_Y, z: FX, texture: assets.spark, tint: 0x9fd8e0, size: 3, count: 18, speed: 90, angle: -Math.PI / 2, spread: 1.6, gravity: 400, life: 0.6 })
        mercy = 0
        hurt(Position.x[player], 2, false)
        if (!dead) {
          Position.x[player] = safe.x
          Position.y[player] = safe.y - Body.foot[player]
          Interpolate.ready[player] = 0
          Body.vx[player] = Body.vy[player] = 0
        }
      }
      if (Position.y[player] > VIEW_H + 40) (hp = 0), showHp(), die()
      for (const c of checkpoints) {
        if (run.checkpoint !== c && Math.abs(Position.x[player] - c.x) < 12 && Math.abs(feet - c.y) < 24) {
          run.checkpoint = c
          banner('checkpoint', 0x1f9e9a, 12)
          sound.play(assets.pickup)
        }
      }
      if (exit && Position.x[player] > exit.x) finish()
    }, 'fixed')

    /** The macuahuitl's reach in front of the player during the swing; lower when crouching. */
    const strikeBox = () => {
      const reach = attack > 0.16 ? 36 : 28
      return { cx: Position.x[player] + facing * (reach / 2 - 4), cy: Position.y[player] + (crouching ? 9 : 2), w: reach, h: 14 }
    }
    const strike = () => {
      const box = strikeBox()
      const hitBox = (e: Entity, w: number, h: number) => Math.abs(Position.x[e] - box.cx) < (box.w + w) / 2 && Math.abs(Position.y[e] - box.cy) < (box.h + h) / 2
      for (const f of [...foes.entities]) {
        if (swingHits.has(f) || !hitBox(f, Body.w[f], Body.h[f])) continue
        swingHits.add(f)
        damageFoe(f, 1, facing)
      }
      for (const b of [...baskets.entities]) if (hitBox(b, 14, 14)) breakBasket(b)
      if (captain.alive && !swingHits.has(captain.e) && hitBox(captain.e, 40, 44)) {
        swingHits.add(captain.e)
        damageCaptain(1)
      }
    }
    const breakBasket = (b: Entity) => {
      sound.play(assets.break)
      renderer.burst({ x: Position.x[b], y: Position.y[b], z: FX, texture: assets.spark, tint: 0xb07850, size: 3, count: 12, speed: 70, gravity: 300, life: 0.5 })
      const kind = Basket.drop[b]
      const art = kind === HEART ? { w: 12, h: 12, texture: assets.heart } : kind === DARTS ? { w: 16, h: 5, texture: assets.dart } : { w: 12, h: 12, texture: assets.cacao }
      const item = world.spawn([Position, { x: Position.x[b], y: Position.y[b] - 4, z: ITEMS }], [Sprite, art], [Pickup, { kind }])
      tween(game, item, Position, { y: Position.y[b] - 2 }, { duration: 0.4, ease: ease.outBack })
      world.despawn(b)
    }
    const damageFoe = (f: Entity, damage: number, from: number) => {
      Foe.hp[f] = Math.max(0, Foe.hp[f] - damage)
      Foe.flash[f] = 0.15
      Foe.awake[f] = 1
      sound.play(assets.hit, { volume: 0.7 })
      if (Foe.kind[f] !== DUMMY) Body.vx[f] = from * 90
      if (Foe.hp[f] > 0) return
      renderer.burst({ x: Position.x[f], y: Position.y[f], z: FX, texture: assets.spark, tint: Foe.kind[f] === DUMMY ? 0xd8b080 : 0xc8ccd4, size: 3, count: 16, speed: 90, gravity: 200, life: 0.6 })
      addScore(Foe.kind[f] === DUMMY ? 50 : Foe.kind[f] === DOG ? 80 : 150)
      if (Foe.kind[f] === RUNNER) world.spawn([Position, { x: Position.x[f], y: Position.y[f], z: ITEMS }], [Sprite, { w: 12, h: 12, texture: assets.gold }], [Pickup, { kind: GOLD }])
      world.despawn(f)
    }

    // --- Foes -----------------------------------------------------------------------------------------------------------------
    game.system((dt) => {
      const { x, y } = Position
      // Backwards: a foe may despawn while we iterate (swap-remove).
      for (let i = foes.entities.length - 1; i >= 0; i--) {
        const f = foes.entities[i]
        if (f === undefined) continue
        Foe.flash[f] = Math.max(0, Foe.flash[f] - dt)
        Sprite.tint[f] = Foe.flash[f] > 0 ? 0xff6a5a : chapter.light.tiles
        const dx = x[player] - x[f]
        const feet = y[f] + Body.foot[f]
        const kind = Foe.kind[f]
        Foe.cool[f] -= dt
        Foe.t[f] -= dt
        if (kind === DUMMY) {
          Sprite.frame[f] = Foe.flash[f] > 0 ? 1 : 0
          continue
        }
        if (Math.abs(dx) > 300 && kind !== RUNNER) continue // asleep off screen
        if (kind === SOLDIER || kind === DOG) {
          const near = Math.abs(dx) < (kind === DOG ? 160 : 100) && Math.abs(y[player] - y[f]) < 28
          if (near && !Foe.awake[f] && kind === DOG) sound.play(assets.bark, { volume: 0.6 })
          if (near) Foe.awake[f] = 1
          if (near && Foe.t[f] <= 0) Foe.dir[f] = Math.sign(dx) || 1
          const ahead = x[f] + Foe.dir[f] * 10
          if (Body.grounded[f] && ((!solidAt(ahead, feet + 4) && !ledgeAt(ahead, feet + 4)) || solidAt(ahead, feet - 8))) Foe.dir[f] *= -1
          // Soldiers stop to slash when close; dogs keep running.
          const slashing = kind === SOLDIER && Foe.cool[f] > 0.5
          if (kind === SOLDIER && near && Math.abs(dx) < 26 && Foe.cool[f] <= 0) {
            Foe.cool[f] = 1.1
            sound.play(assets.swing, { volume: 0.4, rate: 0.7 })
          }
          if (Foe.flash[f] <= 0) Body.vx[f] = slashing ? 0 : Foe.dir[f] * (kind === DOG ? (near ? 120 : 30) : near ? 40 : 24)
          else Body.vx[f] *= 0.85
          step(f, dt, false)
          Sprite.flipX[f] = Foe.dir[f] < 0 ? 1 : 0
          if (kind === SOLDIER) {
            Animation.count[f] = slashing ? 1 : 2
            Animation.start[f] = slashing ? 2 : 0
            Animation.fps[f] = near ? 6 : 4
            // The slash lands in the middle of the swing.
            if (slashing && Foe.cool[f] > 0.75 && Foe.cool[f] < 0.85 && Math.abs(dx) < 30 && Math.abs(y[player] - y[f]) < 24 && Math.sign(dx) === Math.sign(Foe.dir[f])) hurt(x[f])
          } else {
            Animation.count[f] = 2
            Animation.fps[f] = near ? 12 : 5
          }
        } else if (kind === CROSSBOW) {
          Foe.dir[f] = Math.sign(dx) || 1
          Sprite.flipX[f] = dx < 0 ? 1 : 0
          step(f, dt, false)
          Sprite.frame[f] = Foe.cool[f] > 1.6 ? 1 : 0
          if (Math.abs(dx) < 220 && Math.abs(y[player] - y[f]) < 30 && Foe.cool[f] <= 0) {
            Foe.cool[f] = 2.2
            sound.play(assets.twang, { volume: 0.6 })
            world.spawn(
              [Position, { x: x[f] + Foe.dir[f] * 12, y: y[f] - 2, z: ACTORS }],
              [Sprite, { w: 12, h: 4, texture: assets.bolt, flipX: Foe.dir[f] < 0 ? 1 : 0, tint: chapter.light.tiles }],
              [Shot, { kind: BOLT, vx: Foe.dir[f] * 170, vy: 0 }],
            )
          }
        } else if (kind === RUNNER) {
          // Fleeing with the gold: runs once it sees the player, and may fall into the breaches.
          if (Math.abs(dx) < 220) Foe.awake[f] = 1
          if (Foe.awake[f] && Foe.flash[f] <= 0) Body.vx[f] = 62
          step(f, dt, false)
          Sprite.flipX[f] = 0
          Animation.count[f] = 2
          Animation.fps[f] = Body.vx[f] ? 8 : 2
          if (waterAt(x[f], feet - 4)) {
            sound.play(assets.splash, { volume: 0.5 })
            renderer.burst({ x: x[f], y: WATER_Y, z: FX, texture: assets.spark, tint: 0x9fd8e0, size: 3, count: 12, speed: 70, angle: -Math.PI / 2, spread: 1.6, gravity: 400, life: 0.5 })
            world.despawn(f)
          } else if (x[f] > map.width - 24) world.despawn(f)
          continue
        }
        if (waterAt(x[f], feet - 4)) {
          world.despawn(f)
          continue
        }
        if (!dead && mercy <= 0 && overlapsBody(player, f, Body.w[f] - 2, Body.h[f] - 2)) {
          hurt(x[f])
          if (kind !== CROSSBOW) (Foe.dir[f] = -Math.sign(dx) || 1), (Foe.t[f] = 1)
        }
      }
      // Darts and bolts.
      for (let i = shots.entities.length - 1; i >= 0; i--) {
        const s = shots.entities[i]
        if (s === undefined) continue
        if (Shot.kind[s] === DART) Shot.vy[s] += 120 * dt
        x[s] += Shot.vx[s] * dt
        y[s] += Shot.vy[s] * dt
        const gone = solidAt(x[s], y[s]) || Math.abs(x[s] - x[player]) > 400 || y[s] > VIEW_H
        if (Shot.kind[s] === DART) {
          const target = foes.entities.find((f) => Math.abs(x[f] - x[s]) < Body.w[f] / 2 + 6 && Math.abs(y[f] - y[s]) < Body.h[f] / 2 + 2)
          if (target !== undefined) damageFoe(target, 2, Math.sign(Shot.vx[s]))
          else if (captain.alive && Math.abs(x[captain.e] - x[s]) < 24 && Math.abs(y[captain.e] - y[s]) < 26) damageCaptain(2)
          else if (!gone) continue
        } else if (!dead && overlapsBody(player, s, 10, 4)) hurt(x[s] - Shot.vx[s])
        else if (!gone) continue
        renderer.burst({ x: x[s], y: y[s], z: FX, texture: assets.spark, tint: 0xd8d0c0, size: 2, count: 6, speed: 50, life: 0.3 })
        world.despawn(s)
      }
    }, 'fixed')

    // --- Pickups and hints --------------------------------------------------------------------------------------------------
    game.system(() => {
      for (const p of [...pickups.entities]) {
        if (!overlapsBody(player, p, 12, 12)) continue
        const kind = Pickup.kind[p]
        if (kind === HEART) (hp = Math.min(MAX_HP, hp + 2)), showHp()
        else if (kind === DARTS) (run.darts += 5), showDarts()
        else addScore(kind === GOLD ? 500 : kind === CACAO ? 250 : 100)
        sound.play(assets.pickup)
        renderer.burst({ x: Position.x[p], y: Position.y[p], z: FX, texture: assets.spark, tint: 0xf2c14e, size: 2, count: 10, speed: 50, life: 0.4 })
        world.despawn(p)
      }
      showHint(hints.find((h) => Math.abs(Position.x[player] - h.x) < 40))
    })

    // --- The captain (chapter 3) ------------------------------------------------------------------------------------------
    const CAPTAIN_HP = 18
    const captain = { e: -1, bar: -1, alive: false, hp: CAPTAIN_HP, t: 0, mode: 'charge' as 'charge' | 'rear', dir: -1, flash: 0 }
    const damageCaptain = (damage: number) => {
      captain.hp = Math.max(0, captain.hp - damage)
      captain.flash = 0.15
      shakeCamera(3)
      sound.play(assets.hit, { rate: 0.8 })
      renderer.burst({ x: Position.x[captain.e], y: Position.y[captain.e], z: FX, texture: assets.spark, tint: 0xc8ccd4, size: 3, count: 10, speed: 90, life: 0.4 })
      Sprite.w[captain.bar] = (40 * captain.hp) / CAPTAIN_HP
      if (captain.hp > 0) return
      captain.alive = false
      addScore(5000)
      sound.play(assets.drum)
      every(game, 0.15, () =>
        renderer.burst({ x: Position.x[captain.e] + (Math.random() - 0.5) * 50, y: Position.y[captain.e] + (Math.random() - 0.5) * 40, z: FX, texture: assets.spark, tint: Math.random() < 0.5 ? 0xb5302a : 0xf2c14e, size: 4, count: 14, speed: 120, life: 0.7 }),
      )
      tween(game, captain.e, Sprite, { alpha: 0 }, { duration: 2 })
      banner('the captain falls', 0xf2c14e, 22)
      after(game, 1.5, finish)
    }
    // The gate closes behind the player and the captain rides in.
    game.system(() => {
      if (!captainSpot || gateClosed || Position.x[player] < gateX + 40) return
      gateClosed = true
      for (let ty = 0; ty < 15; ty++) {
        const block = world.spawn([Position, { x: gateX + 8, y: ty * 16 + 8, z: ACTORS }], [Sprite, { w: 16, h: 16, texture: assets.tiles, frame: 5, alpha: 0, tint: chapter.light.tiles }])
        tween(game, block, Sprite, { alpha: 1 }, { duration: 0.4 })
      }
      sound.play(assets.drum)
      shakeCamera(8)
      banner('the mounted captain', 0xb5302a, 22)
      captain.e = world.spawn([Position, { x: map.width + 40, y: captainSpot.y - 32, z: ACTORS }], [Sprite, { w: 64, h: 64, texture: assets.captain, tint: chapter.light.tiles }], [Animation, { count: 2, fps: 8 }], [Interpolate])
      // Its health rides above it: a bar attached to the captain.
      const frame = world.spawn([Position], [Sprite, { w: 44, h: 6, tint: 0x0b0a0c, alpha: 0.8 }])
      captain.bar = world.spawn([Position], [Sprite, { w: 40, h: 3, tint: 0xb5302a }])
      attach(world, frame, captain.e, { y: -38, z: 0.4 })
      attach(world, captain.bar, captain.e, { y: -38, z: 0.5 })
      tween(game, captain.e, Position, { x: captainSpot.x }, { duration: 1.6, ease: ease.out, onDone: () => (captain.alive = true) })
    })
    game.system((dt) => {
      if (!captain.alive || dead) return
      const e = captain.e
      captain.t += dt
      captain.flash = Math.max(0, captain.flash - dt)
      Sprite.tint[e] = captain.flash > 0 ? 0xff6a5a : chapter.light.tiles
      const angry = captain.hp <= CAPTAIN_HP / 2
      const leftWall = gateX + 56
      const rightWall = map.width - 40
      if (captain.mode === 'charge') {
        Animation.start[e] = 0
        Animation.count[e] = 2
        Position.x[e] += captain.dir * (angry ? 190 : 150) * dt
        if ((captain.dir < 0 && Position.x[e] < leftWall) || (captain.dir > 0 && Position.x[e] > rightWall)) {
          captain.mode = 'rear'
          captain.t = 0
          sound.play(assets.drum, { volume: 0.5, rate: 1.3 })
          shakeCamera(4)
        }
      } else {
        // The horse rears at the wall: the moment to strike.
        Animation.start[e] = 2
        Animation.count[e] = 1
        if (captain.t > (angry ? 0.7 : 1.1)) (captain.mode = 'charge'), (captain.dir *= -1), (captain.t = 0)
      }
      Sprite.flipX[e] = captain.dir < 0 ? 1 : 0
      // The horse's body (40 x 36, a little below the sprite's center): low enough to stand above it on the beams.
      const cy = Position.y[e]
      Position.y[e] = cy + 4
      const hit = overlapsBody(player, e, 40, 36)
      Position.y[e] = cy
      if (hit) hurt(Position.x[e], 1)
    }, 'fixed')

    // --- Weather (chapter 4): rain and lightning -------------------------------------------------------------------------
    if (chapter.rain) {
      const camera = game.get(Camera)
      game.system(() => {
        const hw = camera.width / 2 / camera.zoom
        for (let i = 0; i < 3; i++)
          renderer.burst({ x: camera.x - hw + Math.random() * (hw * 2 + 80), y: -10, z: RAIN, texture: assets.spark, tint: 0x9fb8e0, size: 1.5, count: 1, speed: 320, angle: Math.PI / 2 + 0.25, spread: 0.05, life: 0.9 })
      })
      const flash = rect(0, 0, 640, 360, 0xc8d8ff, 0, FLASH)
      const lightning = () => {
        Sprite.alpha[flash] = 0.55
        tween(game, flash, Sprite, { alpha: 0 }, { duration: 0.5 })
        after(game, 0.4, () => sound.play(assets.drum, { volume: 0.4, rate: 0.6 }))
        after(game, 5 + Math.random() * 7, lightning)
      }
      after(game, 3, lightning)
    }

    // --- Player animation and debug hitboxes (F2) --------------------------------------------------------------------------
    const tag = assets.hero.tags
    game.system(() => {
      if (dead) return
      const grounded = Body.grounded[player] === 1
      const [first, count, fps] =
        stun > 0 ? [tag.hurt.start, 1, 1]
        : throwing >= 0 ? [tag.throw.start, 1, 1]
        : attack >= 0 ? [tag.strike.start + (attack < 0.08 ? 0 : attack < 0.16 ? 1 : 2), 1, 1]
        : !grounded ? [tag.jump.start, 1, 1]
        : crouching ? [tag.crouch.start, 1, 1]
        : Body.vx[player] ? [tag.run.start, tag.run.count, 10]
        : [tag.idle.start, 1, 1]
      if (Animation.start[player] !== first) (Animation.start[player] = first), (Animation.time[player] = 0)
      Animation.count[player] = count
      Animation.fps[player] = fps
      Sprite.flipX[player] = facing < 0 ? 1 : 0
      Sprite.alpha[player] = mercy > 0 && Math.floor(mercy * 12) % 2 ? 0.35 : 1
      if (!hitboxes) return
      for (const e of [player, ...foes.entities]) debug.rect(Position.x[e], Position.y[e] + Body.foot[e] - Body.h[e] / 2, Body.w[e], Body.h[e], e === player ? 0x00ff00 : 0xff4040)
      if (attack > 0.08) {
        const box = strikeBox()
        debug.rect(box.cx, box.cy, box.w, box.h, 0xffff00)
      }
      if (captain.alive) debug.rect(Position.x[captain.e], Position.y[captain.e] + 4, 40, 36, 0xff4040)
    })
  }

/** A chapter's level with a fresh run, for development (`?chapter=N`). */
export const chapter = (index: number) => level({ chapter: index, lives: 3, score: 0, darts: 5 })

export const end =
  (won: boolean, run: Run): Scene =>
  (game) => {
    const { text, panel, follow, snap } = stage(game, chapters[won ? 3 : run.chapter])
    const input = game.get(Input)
    let t = 0
    game.system((dt) => (t += dt))
    follow(() => 300 + t * 15, 100000)
    snap(300)
    panel(110, 40, 420, 250)
    text(won ? 'The night of 30 June 1520' : 'Tenochtitlan endures', { x: 320, y: 62, size: 18, tint: 0xb5302a })
    text(won ? EPILOGUE : 'You fell, but the city fights on. Take up the macuahuitl again.', { x: 136, y: 96, size: 10, tint: 0x141016, align: 'left', maxWidth: 368 })
    text(`score ${run.score}`, { x: 320, y: 262, size: 12, tint: 0x7a1f1b })
    const prompt = text('press enter or tap to play again', { x: 320, y: 306, size: 11, tint: 0xf3e6c9 })
    every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))
    let ready = false
    after(game, 1, () => (ready = true))
    game.system(() => {
      if (!ready || !confirmed(input)) return
      game.get(Audio).play(assets.start)
      void game.scene(title)
    })
  }
