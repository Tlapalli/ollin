import {
  after,
  Animation,
  Audio,
  burst,
  Camera,
  defineComponent,
  ease,
  every,
  f32,
  hit,
  Input,
  Position,
  Renderer,
  spawnText,
  Sprite,
  tween,
  u8,
  type Entity,
  type Game,
  type Scene,
  type Text,
  type TextOptions,
} from '../../src'

/** Arena size in art pixels. The camera never moves, it only scales the arena to fit, so text lives in world space too. */
const W = 480
const H = 272
const FLOOR = 0
const PORTAL = 1
const ACTORS = 2
const TEXT = 10

const LEVELS = [
  { petals: 6, wanderers: 2, chasers: 0, speed: 40 },
  { petals: 8, wanderers: 3, chasers: 1, speed: 48 },
  { petals: 10, wanderers: 4, chasers: 2, speed: 56 },
]

/** What carries over from one level to the next. */
interface Run {
  lives: number
  petals: number
}

const Spirit = defineComponent({ vx: f32, vy: f32, chase: u8 })

const url = (file: string) => new URL(`./${file}`, import.meta.url).href
const pixelArt = (file: string, size: number) => [url(file), { frameWidth: size, frameHeight: size, filter: 'nearest' }] as const

/** Every scene asks for what it needs; loaders cache by URL, so only the first scene waits. */
async function load(game: Game) {
  const renderer = game.get(Renderer)
  const [textures, sounds, font] = await Promise.all([
    renderer.loadTextures({
      xolo: pixelArt('xolo.png', 16),
      petal: pixelArt('petal.png', 12),
      spirit: pixelArt('spirit.png', 16),
      portal: pixelArt('portal.png', 24),
      floor: pixelArt('floor.png', 16),
      heart: pixelArt('heart.png', 9),
      spark: url('spark.png'),
    }),
    game.get(Audio).load({ petal: url('petal.wav'), hurt: url('hurt.wav'), portal: url('portal.wav'), start: url('start.wav') }),
    renderer.loadFont({ family: 'ui-monospace, monospace', size: 48, weight: 'bold' }),
  ])
  const text = (value: string, options: TextOptions) => spawnText(game.world, font, value, { z: TEXT, align: 'center', ...options })
  return { textures, sounds, text }
}

/** Stone floor and a camera that fits the arena in the window. */
function arena(game: Game, floor: number) {
  for (let y = 0; y < H; y += 16) {
    for (let x = 0; x < W; x += 16) {
      const r = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 // stable noise: every scene is the same place
      game.world.spawn([Position, { x: x + 8, y: y + 8, z: FLOOR }], [Sprite, { w: 16, h: 16, texture: floor, frame: r < 0.08 ? 2 : r < 0.3 ? 1 : 0 }])
    }
  }
  const camera = game.get(Camera)
  game.system(() => {
    camera.x = W / 2
    camera.y = H / 2
    camera.zoom = Math.min(game.canvas.width / W, game.canvas.height / H)
  })
}

const confirmed = (input: Input) => ['Space', 'Enter', 'Pointer', 'Button0', 'Button9'].some((key) => input.pressed.has(key))

/** Turns a text on and off every half second. */
const blink = (game: Game, text: Text) => every(game, 0.5, () => (text.alpha = text.alpha ? 0 : 1))

export const menu: Scene = async (game) => {
  const { textures, sounds, text } = await load(game)
  const { world } = game
  const input = game.get(Input)
  arena(game, textures.floor)

  text('XOLO', { x: W / 2, y: 40, size: 56, tint: 0xf28c28 })
  text('guide the cempasúchil petals home', { x: W / 2, y: 104, size: 12, tint: 0xf3e6c9 })
  blink(game, text('press space or tap to start', { x: W / 2, y: 228, size: 11, tint: 0x1f9e9a }))

  // A xolo trots back and forth: each tween starts the next one when it ends.
  const dog = world.spawn([Position, { x: 140, y: 170, z: ACTORS }], [Sprite, { w: 16, h: 16, texture: textures.xolo }], [Animation, { count: 2, fps: 6 }])
  const trot = (to: number) => {
    Sprite.flipX[dog] = to < Position.x[dog] ? 1 : 0
    tween(game, dog, Position, { x: to }, { duration: 3, ease: ease.inOut, onDone: () => trot(to === 340 ? 140 : 340) })
  }
  trot(340)
  for (let i = 0; i < 5; i++) {
    world.spawn([Position, { x: 112 + i * 64, y: 196, z: ACTORS }], [Sprite, { w: 12, h: 12, texture: textures.petal }], [Animation, { count: 2, fps: 3, time: i * 0.2 }])
  }

  game.system(() => {
    if (!confirmed(input)) return
    game.get(Audio).play(sounds.start)
    void game.scene(level(0, { lives: 3, petals: 0 }))
  })
}

export const level =
  (n: number, run: Run): Scene =>
  async (game) => {
    const { textures, sounds, text } = await load(game)
    const { world } = game
    const input = game.get(Input)
    const sound = game.get(Audio)
    const camera = game.get(Camera)
    const config = LEVELS[n]
    arena(game, textures.floor)

    const player = world.spawn([Position, { x: W / 2, y: H / 2, z: ACTORS }], [Sprite, { w: 16, h: 16, texture: textures.xolo }], [Animation, { count: 2 }])
    /** A random spot in the arena at least `min` px from the player. */
    const away = (min: number) => {
      let spot: { x: number; y: number }
      do spot = { x: 24 + Math.random() * (W - 48), y: 32 + Math.random() * (H - 56) }
      while (Math.hypot(spot.x - Position.x[player], spot.y - Position.y[player]) < min)
      return spot
    }

    const petals = Array.from({ length: config.petals }, (_, i) =>
      world.spawn([Position, { ...away(40), z: ACTORS }], [Sprite, { w: 12, h: 12, texture: textures.petal }], [Animation, { count: 2, fps: 3, time: i * 0.37 }]),
    )
    // Wanderers glow turquoise and drift; chasers glow red and hunt. The art has white eyes, so the tint shows true colors.
    for (let i = 0; i < config.wanderers + config.chasers; i++) {
      const chase = i >= config.wanderers
      const angle = Math.random() * Math.PI * 2
      const e = world.spawn(
        [Position, { ...away(120), z: ACTORS }],
        [Sprite, { w: 16, h: 16, texture: textures.spirit, tint: chase ? 0xff5a4a : 0x6ff2e8, alpha: 0 }],
        [Animation, { count: 2, fps: 4 }],
        [Spirit, { vx: Math.cos(angle) * config.speed, vy: Math.sin(angle) * config.speed, chase: chase ? 1 : 0 }],
      )
      tween(game, e, Sprite, { alpha: 1 }, { duration: 1 })
    }
    const spirits = world.query(Spirit)

    // HUD
    const hearts: Entity[] = []
    const showLives = () => {
      for (const e of hearts.splice(0)) world.despawn(e)
      for (let i = 0; i < run.lives; i++) hearts.push(world.spawn([Position, { x: 14 + i * 13, y: 12, z: TEXT }], [Sprite, { w: 9, h: 9, texture: textures.heart }]))
    }
    showLives()
    text(`level ${n + 1}/${LEVELS.length}`, { x: W / 2, y: 4, size: 10, tint: 0xf3e6c9 })
    const count = text('', { x: W - 8, y: 4, size: 10, tint: 0xf28c28, align: 'right' })
    let collected = 0
    const showCount = () => count.set(`petals ${collected}/${config.petals}`)
    showCount()
    const banner = (value: string) => {
      const t = text(value, { x: W / 2, y: H / 2 - 48, size: 18, tint: 0xf2c14e })
      after(game, 1.2, () => t.entities.forEach((e) => tween(game, e, Sprite, { alpha: 0 }, { duration: 0.6, onDone: () => world.despawn(e) })))
    }
    banner(n === 0 ? 'gather every petal' : `level ${n + 1}`)

    let portal = -1
    let hurt = false
    let over = false
    const SPEED = 90

    // Keyboard, gamepad (stick or d-pad), or walk toward a held finger or mouse button.
    game.system((dt) => {
      if (over) return
      const { x, y } = Position
      const { keys, pointers } = input
      const pad = input.gamepads.find((p) => p)
      const key = (a: string, b: string) => Number(keys.has(a) || keys.has(b))
      const button = (i: number) => Number(!!pad?.buttons[i]?.pressed)
      const stick = (i: number) => (Math.abs(pad?.axes[i] ?? 0) > 0.2 ? pad!.axes[i] : 0)
      let dx = key('ArrowRight', 'KeyD') - key('ArrowLeft', 'KeyA') + button(15) - button(14) + stick(0)
      let dy = key('ArrowDown', 'KeyS') - key('ArrowUp', 'KeyW') + button(13) - button(12) + stick(1)
      const [finger] = pointers.values()
      if (finger) {
        const target = camera.toWorld(finger.x, finger.y)
        dx = target.x - x[player]
        dy = target.y - y[player]
        if (Math.hypot(dx, dy) < 3) dx = dy = 0
      }
      const length = Math.hypot(dx, dy)
      const step = (SPEED * dt) / Math.max(1, length) // full speed on keys and far targets, analog on a stick
      x[player] = Math.min(Math.max(x[player] + dx * step, 8), W - 8)
      y[player] = Math.min(Math.max(y[player] + dy * step, 8), H - 8)
      if (dx) Sprite.flipX[player] = dx < 0 ? 1 : 0
      Animation.fps[player] = length ? 8 : 0
      if (!length) Animation.time[player] = 0
    })

    game.system((dt) => {
      const { x, y } = Position
      for (const e of spirits.entities) {
        if (Spirit.chase[e] && !over) {
          // Steer toward the player, a little slower than the player, so it can be outrun.
          const ax = x[player] - x[e]
          const ay = y[player] - y[e]
          const d = Math.hypot(ax, ay) || 1
          const turn = Math.min(1, dt * 1.5)
          Spirit.vx[e] += ((ax / d) * config.speed * 0.85 - Spirit.vx[e]) * turn
          Spirit.vy[e] += ((ay / d) * config.speed * 0.85 - Spirit.vy[e]) * turn
        }
        x[e] += Spirit.vx[e] * dt
        y[e] += Spirit.vy[e] * dt
        if (x[e] < 8 || x[e] > W - 8) Spirit.vx[e] *= -1
        if (y[e] < 8 || y[e] > H - 8) Spirit.vy[e] *= -1
        x[e] = Math.min(Math.max(x[e], 8), W - 8)
        y[e] = Math.min(Math.max(y[e], 8), H - 8)
        Sprite.flipX[e] = Spirit.vx[e] < 0 ? 1 : 0
      }
    })

    const openPortal = () => {
      portal = world.spawn([Position, { ...away(80), z: PORTAL }], [Sprite, { w: 0, h: 0, texture: textures.portal }], [Animation, { count: 2, fps: 6 }])
      tween(game, portal, Sprite, { w: 24, h: 24 }, { duration: 0.6, ease: ease.outBack })
      sound.play(sounds.portal)
      banner('the portal is open')
    }

    game.system(() => {
      if (over) return
      const { x, y } = Position
      const petal = hit(player, petals, 1)
      if (petal >= 0) {
        burst(world, { x: x[petal], y: y[petal], z: ACTORS, texture: textures.spark, tint: 0xf28c28, size: 3, count: 12, speed: 60, life: 0.5 })
        world.despawn(petal)
        petals.splice(petals.indexOf(petal), 1)
        collected++
        run.petals++
        sound.play(sounds.petal, { rate: 0.9 + collected * 0.05 })
        showCount()
        if (!petals.length) openPortal()
      }

      if (portal >= 0 && hit(player, [portal], 6) >= 0) {
        over = true
        sound.play(sounds.start, { rate: 1.5 })
        const next = n + 1 < LEVELS.length ? level(n + 1, run) : end(true, run)
        tween(game, player, Sprite, { w: 0, h: 0 }, { duration: 0.4, ease: ease.in, onDone: () => void game.scene(next) })
        return
      }

      if (hurt) return
      const spirit = hit(player, spirits.entities, 3)
      if (spirit < 0) return
      run.lives--
      showLives()
      sound.play(sounds.hurt)
      burst(world, { x: x[player], y: y[player], z: ACTORS, texture: textures.spark, tint: 0xb5302a, size: 3, count: 16, speed: 80, life: 0.6 })
      if (run.lives <= 0) {
        over = true
        tween(game, player, Sprite, { alpha: 0 }, { duration: 0.8, onDone: () => void game.scene(end(false, run)) })
        return
      }
      // A moment of mercy: blink and ignore spirits for 1.5 s.
      hurt = true
      const stop = every(game, 0.1, () => (Sprite.alpha[player] = Sprite.alpha[player] < 1 ? 1 : 0.25))
      after(game, 1.5, () => {
        stop()
        Sprite.alpha[player] = 1
        hurt = false
      })
    })
  }

export const end =
  (won: boolean, run: Run): Scene =>
  async (game) => {
    const { textures, sounds, text } = await load(game)
    const input = game.get(Input)
    arena(game, textures.floor)

    text(won ? 'the souls are home' : 'the spirits caught you', { x: W / 2, y: 60, size: 24, tint: won ? 0xf2c14e : 0xb5302a })
    text(`petals gathered: ${run.petals}`, { x: W / 2, y: 120, size: 12, tint: 0xf3e6c9 })
    blink(game, text('press space or tap to play again', { x: W / 2, y: 228, size: 11, tint: 0x1f9e9a }))
    if (won) {
      every(game, 0.35, () =>
        burst(game.world, {
          x: 40 + Math.random() * (W - 80),
          y: 40 + Math.random() * 120,
          z: ACTORS,
          texture: textures.spark,
          tint: Math.random() < 0.5 ? 0xf28c28 : 0xf2c14e,
          size: 3,
          count: 24,
          speed: 70,
          gravity: 60,
          life: 1.2,
        }),
      )
    }

    // Wait a moment so the key that ended the level does not skip this screen.
    let ready = false
    after(game, 0.6, () => (ready = true))
    game.system(() => {
      if (!ready || !confirmed(input)) return
      game.get(Audio).play(sounds.start)
      void game.scene(menu)
    })
  }
