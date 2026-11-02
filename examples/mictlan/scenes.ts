import {
  after,
  Animation,
  Audio,
  Camera,
  defineComponent,
  drawnPosition,
  ease,
  every,
  f32,
  Input,
  Interpolate,
  loadTilemap,
  Position,
  Renderer,
  spawnText,
  Sprite,
  tween,
  u8,
  type Entity,
  type Game,
  type Scene,
  type TextOptions,
} from '../../src'

// Mictlan: a side-scrolling action platformer. A warrior descends into the land of the dead with a macuahuitl,
// breaks clay urns, fights skeletons and bats, and faces Itzpapalotl, the obsidian butterfly, at the bottom.

/** Tiled layers: back 0, decor 1, solid 2, ledges 3, hazards 4, things 5. Parallax sits behind, actors in front. */
const FAR = -2
const NEAR = -1
const ITEMS = 6
const ACTORS = 7
const PANELS = 99
const HUD = 100

const MAX_HP = 6
const GRAVITY = 900
const RUN = 85
const JUMP = 300
const MAX_FALL = 420

interface Run {
  lives: number
  score: number
  /** Where the player respawns: the start, or the last checkpoint touched. */
  checkpoint?: { x: number; y: number }
}

/** Anything that moves under gravity and collides with the map: hitbox `w`x`h` centered on x, bottom at `y + foot`. */
const Body = defineComponent({ vx: f32, vy: f32, w: f32, h: f32, foot: f32, grounded: u8 })
const SKELETON = 0
const BAT = 1
const Foe = defineComponent({ kind: u8, hp: u8, dir: f32, flash: f32, awake: u8, t: f32 })
const Urn = defineComponent({ drop: u8 })
const HEART = 1
const CACAO = 2
const Pickup = defineComponent({ kind: u8 })
const Shard = defineComponent({ vy: f32 })

const url = (file: string) => new URL(`./${file}`, import.meta.url).href
const art = (file: string, w: number, h: number) => [url(file), { frameWidth: w, frameHeight: h, filter: 'nearest' }] as const

async function load(game: Game) {
  const renderer = game.get(Renderer)
  const [map, textures, sounds, font] = await Promise.all([
    loadTilemap(game, url('map.tmj')),
    renderer.loadTextures({
      hero: art('hero.png', 24, 24),
      skeleton: art('skeleton.png', 16, 24),
      bat: art('bat.png', 16, 12),
      boss: art('boss.png', 48, 40),
      urn: art('urn.png', 12, 14),
      heart: art('heart.png', 9, 9),
      cacao: art('cacao.png', 10, 10),
      shard: art('shard.png', 6, 10),
      far: art('far.png', 128, 96),
      near: art('near.png', 128, 96),
      tiles: art('tiles.png', 16, 16),
      spark: url('spark.png'),
    }),
    game.get(Audio).load({
      swing: url('swing.wav'),
      hit: url('hit.wav'),
      break: url('break.wav'),
      jump: url('jump.wav'),
      hurt: url('hurt.wav'),
      pickup: url('pickup.wav'),
      boss: url('boss.wav'),
      start: url('start.wav'),
    }),
    renderer.loadFont({ family: 'ui-monospace, monospace', size: 48, weight: 'bold' }),
  ])
  renderer.screen.add(HUD)
  renderer.screen.add(PANELS)
  const ui = game.canvas.height / 360
  const text = (value: string, options: TextOptions) =>
    spawnText(game.world, font, value, { z: HUD, align: 'center', ...options, x: (options.x ?? 0) * ui, y: (options.y ?? 0) * ui, size: (options.size ?? 12) * ui })
  /** A solid band in UI pixels (a Sprite without a texture is a rectangle in its tint). */
  const rect = (x: number, y: number, w: number, h: number, tint: number, alpha = 1, z = PANELS) =>
    game.world.spawn([Position, { x: (x + w / 2) * ui, y: (y + h / 2) * ui, z }], [Sprite, { w: w * ui, h: h * ui, tint, alpha }])

  // The camera shows the whole map height and follows a target horizontally; two parallax layers scroll slower.
  const camera = game.get(Camera)
  const LAYER = 256
  const layers = [
    { z: FAR, texture: textures.far, speed: 0.15, y: 110 },
    { z: NEAR, texture: textures.near, speed: 0.4, y: 120 },
  ].map((l) => ({ ...l, tiles: Array.from({ length: 8 }, () => game.world.spawn([Position, { z: l.z, y: l.y }], [Sprite, { w: LAYER, h: 192, texture: l.texture }])) }))
  let shake = 0
  const follow = (target: () => number) =>
    game.system((dt) => {
      camera.zoom = game.canvas.height / map.height
      const hw = camera.width / 2 / camera.zoom
      const goal = Math.min(Math.max(target(), hw), map.width - hw)
      camera.x += (goal - camera.x) * Math.min(1, dt * 8)
      camera.x = Math.min(Math.max(camera.x, hw), map.width - hw)
      shake = Math.max(0, shake - dt * 30)
      camera.y = map.height / 2 + (Math.random() - 0.5) * shake
      // ponytail: parallax in game code (a few big sprites per frame); a per-layer scroll factor in the renderer if games need many layers
      for (const l of layers) {
        const start = camera.x - hw - ((camera.x * l.speed) % LAYER)
        l.tiles.forEach((e, i) => (Position.x[e] = start + i * LAYER + LAYER / 2))
      }
    })
  const snap = (x: number) => {
    camera.zoom = game.canvas.height / map.height
    const hw = camera.width / 2 / camera.zoom
    camera.x = Math.min(Math.max(x, hw), map.width - hw)
  }
  return { map, textures, sounds, text, rect, ui, follow, snap, shakeCamera: (amount: number) => (shake = Math.max(shake, amount)) }
}

const confirmed = (input: Input) => ['Space', 'Enter', 'Pointer', 'Button0', 'Button9'].some((key) => input.pressed.has(key))

export const menu: Scene = async (game) => {
  const { map, sounds, text, rect, follow, snap } = await load(game)
  const input = game.get(Input)
  let t = 0
  game.system((dt) => (t += dt))
  snap(0)
  follow(() => 200 + (1 - Math.cos(t * 0.1)) * (map.width / 2 - 200))
  rect(0, 60, 640, 110, 0x0b0a0c, 0.65)
  rect(0, 262, 640, 70, 0x0b0a0c, 0.65)
  text('MICTLAN', { x: 320, y: 72, size: 56, tint: 0xb5302a })
  text('descend to the land of the dead and face the obsidian butterfly', { x: 320, y: 140, size: 11, tint: 0xf3e6c9 })
  text('move: arrows / A D / stick · jump: Z / K / space / A button · strike: X / J / B or X button', { x: 320, y: 272, size: 9, tint: 0xf3e6c9, alpha: 0.85 })
  text('touch: left third walk left, right third walk right, top half jump, bottom-middle strike', { x: 320, y: 288, size: 9, tint: 0xf3e6c9, alpha: 0.85 })
  const prompt = text('press enter or tap to begin', { x: 320, y: 308, size: 11, tint: 0x1f9e9a })
  every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))
  game.system(() => {
    if (!['Enter', 'Pointer', 'Button9', 'Space'].some((k) => input.pressed.has(k))) return
    game.get(Audio).play(sounds.start)
    void game.scene(descent({ lives: 3, score: 0 }))
  })
}

export const descent =
  (run: Run): Scene =>
  async (game) => {
    const { map, textures, sounds, text, rect, ui, follow, snap, shakeCamera } = await load(game)
    const { world, canvas } = game
    const input = game.get(Input)
    const sound = game.get(Audio)
    const renderer = game.get(Renderer)

    let gateX = Infinity
    let gateClosed = false
    const solidAt = (px: number, py: number) => map.tileAt('solid', px, py) >= 0 || (gateClosed && px >= gateX && px < gateX + 16)
    const ledgeAt = (px: number, py: number) => map.tileAt('ledges', px, py) >= 0
    const spikesAt = (px: number, py: number) => map.tileAt('hazards', px, py) >= 0

    // --- Things from the map ----------------------------------------------------------------------------------------
    const things = (cls: string) => map.objects.filter((o) => o.type === cls)
    const start = run.checkpoint ?? map.objects.find((o) => o.name === 'player')!
    const spawnBody = (px: number, bottom: number, w: number, h: number, sprite: { w: number; h: number; texture: number }) =>
      world.spawn(
        [Position, { x: px, y: bottom - sprite.h / 2, z: ACTORS }],
        [Sprite, sprite],
        [Body, { w, h, foot: sprite.h / 2 }],
        [Interpolate],
        [Animation, { count: 1 }],
      )

    const player = spawnBody(start.x, start.y, 10, 20, { w: 24, h: 24, texture: textures.hero })
    for (const o of things('skeleton')) {
      const e = spawnBody(o.x, o.y, 10, 22, { w: 16, h: 24, texture: textures.skeleton })
      world.add(e, Foe, { kind: SKELETON, hp: 3, dir: -1 })
    }
    for (const o of things('bat')) {
      world.spawn(
        [Position, { x: o.x, y: o.y, z: ACTORS }],
        [Sprite, { w: 16, h: 12, texture: textures.bat }],
        [Interpolate],
        [Animation, { count: 2, fps: 0 }],
        [Foe, { kind: BAT, hp: 1 }],
      )
    }
    for (const o of things('urn')) world.spawn([Position, { x: o.x, y: o.y - 7, z: ITEMS }], [Sprite, { w: 12, h: 14, texture: textures.urn }], [Urn, { drop: Number(o.properties.drop ?? 1) }])
    const checkpoints = things('checkpoint')
    const gate = things('gate')[0]
    gateX = gate.x - 8
    const bossSpot = things('boss')[0]

    const foes = world.query(Foe)
    const urns = world.query(Urn)
    const pickups = world.query(Pickup)
    const shards = world.query(Shard)

    // --- HUD --------------------------------------------------------------------------------------------------------
    rect(0, 0, 640, 24, 0x0b0a0c, 0.7)
    let hp = MAX_HP
    const hearts = Array.from({ length: MAX_HP }, (_, i) =>
      world.spawn([Position, { x: (14 + i * 12) * ui, y: 12 * ui, z: HUD }], [Sprite, { w: 9 * ui, h: 9 * ui, texture: textures.heart }]),
    )
    const showHp = () => hearts.forEach((e, i) => (Sprite.alpha[e] = i < hp ? 1 : 0.2))
    text(`lives ${run.lives}`, { x: 110, y: 6, size: 10, tint: 0xf3e6c9, align: 'left' })
    const score = text('', { x: 630, y: 6, size: 10, tint: 0xf2c14e, align: 'right' })
    const addScore = (n: number) => score.set(`${(run.score += n)}`)
    addScore(0)
    const banner = (value: string, tint = 0xf2c14e, size = 20) => {
      const t = text(value, { x: 320, y: 110, size, tint })
      after(game, 1.8, () => t.entities.forEach((e) => tween(game, e, Sprite, { alpha: 0 }, { duration: 0.6, onDone: () => world.despawn(e) })))
    }
    if (!run.checkpoint) banner('the first circle of Mictlan', 0xf3e6c9, 14)

    snap(start.x)
    follow(() => drawnPosition(game, player).x)

    // --- Input: sampled every frame in `update`, consumed by the fixed-step physics ----------------------------------------
    let left = false
    let right = false
    let down = false
    let jumpHeld = false
    let jumpBuffer = 0
    let strikeBuffer = 0
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
      if (['KeyX', 'KeyJ', 'Button1', 'Button2'].some((k) => pressed.has(k))) strikeBuffer = 0.12
      // A tap in the bottom-middle strikes; a tap in the top half jumps.
      if (pressed.has('Pointer') && touch(1 / 3, 2 / 3, 0.5, 1)) strikeBuffer = 0.12
      if (pressed.has('Pointer') && touch(0, 1, 0, 0.5)) jumpBuffer = 0.12
      jumpBuffer -= dt
      strikeBuffer -= dt
    })

    // --- Physics: gravity and tile collision for every Body, in the fixed step --------------------------------------------
    /** Moves a body one axis at a time against solid tiles; ledges only stop it from above. */
    const step = (e: Entity, dt: number, dropThrough: boolean) => {
      const { x, y } = Position
      const hw = Body.w[e] / 2
      Body.vy[e] = Math.min(Body.vy[e] + GRAVITY * dt, MAX_FALL)
      // Horizontal
      const nx = x[e] + Body.vx[e] * dt
      const top = y[e] + Body.foot[e] - Body.h[e] + 1
      const bottom = y[e] + Body.foot[e] - 1
      const edge = Body.vx[e] > 0 ? nx + hw : nx - hw
      if (Body.vx[e] && (solidAt(edge, top) || solidAt(edge, bottom) || solidAt(edge, (top + bottom) / 2))) {
        x[e] = Body.vx[e] > 0 ? Math.floor(edge / 16) * 16 - hw - 0.01 : Math.ceil(edge / 16) * 16 + hw + 0.01
        Body.vx[e] = 0
      } else x[e] = nx
      // Vertical
      const feet = y[e] + Body.foot[e]
      const ny = y[e] + Body.vy[e] * dt
      const nfeet = ny + Body.foot[e]
      Body.grounded[e] = 0
      const under = (py: number) => solidAt(x[e] - hw + 1, py) || solidAt(x[e] + hw - 1, py)
      const onLedge = (py: number) => !dropThrough && (ledgeAt(x[e] - hw + 1, py) || ledgeAt(x[e] + hw - 1, py))
      if (Body.vy[e] >= 0 && (under(nfeet) || (onLedge(nfeet) && Math.floor(feet / 16) < Math.floor(nfeet / 16) + (feet % 16 === 0 ? 1 : 0)))) {
        y[e] = Math.floor(nfeet / 16) * 16 - Body.foot[e]
        Body.vy[e] = 0
        Body.grounded[e] = 1
      } else if (Body.vy[e] < 0 && (solidAt(x[e] - hw + 1, ny + Body.foot[e] - Body.h[e]) || solidAt(x[e] + hw - 1, ny + Body.foot[e] - Body.h[e]))) {
        y[e] = Math.ceil((ny + Body.foot[e] - Body.h[e]) / 16) * 16 - Body.foot[e] + Body.h[e]
        Body.vy[e] = 0
      } else y[e] = ny
    }

    // --- Player ---------------------------------------------------------------------------------------------------------
    let facing = 1
    let coyote = 0
    let attack = -1 // seconds into the current swing, -1 when not swinging
    let stun = 0 // knocked back, no control
    let mercy = 0
    let dead = false
    const ATTACK = 0.34
    const swingHits = new Set<Entity>()

    const hurt = (from: number, damage = 1) => {
      if (mercy > 0 || dead) return
      hp = Math.max(0, hp - damage)
      showHp()
      sound.play(sounds.hurt)
      shakeCamera(6)
      renderer.burst({ x: Position.x[player], y: Position.y[player], z: ACTORS, texture: textures.spark, tint: 0xb5302a, size: 3, count: 14, speed: 90, life: 0.5 })
      // The classic knockback: thrown up and away from the hit, no control for a moment.
      const away = Position.x[player] < from ? -1 : 1
      Body.vx[player] = away * 110
      Body.vy[player] = -200
      stun = 0.35
      mercy = 1.6
      attack = -1
      if (hp <= 0) die()
    }
    const die = () => {
      dead = true
      run.lives--
      Animation.start[player] = 9
      tween(game, player, Sprite, { alpha: 0 }, { duration: 1.2, onDone: () => void game.scene(run.lives > 0 ? descent(run) : end(false, run)) })
    }

    game.system((dt) => {
      if (dead) return
      mercy -= dt
      stun -= dt
      coyote = Body.grounded[player] ? 0.08 : coyote - dt
      const grounded = Body.grounded[player] === 1
      const crouch = grounded && down && attack < 0 && stun <= 0
      if (stun <= 0) {
        const dir = Number(right) - Number(left)
        // Swinging on the ground plants your feet; in the air you keep your momentum.
        if (attack >= 0 && grounded) Body.vx[player] = 0
        else if (attack < 0 || !grounded) Body.vx[player] = crouch ? 0 : dir * RUN
        if (dir && attack < 0) facing = dir
        if (jumpBuffer > 0 && coyote > 0 && attack < 0 && !(down && grounded)) {
          Body.vy[player] = -JUMP
          jumpBuffer = 0
          coyote = 0
          sound.play(sounds.jump, { volume: 0.5 })
        }
        // Down + jump on a ledge drops through it.
        if (jumpBuffer > 0 && down && grounded) jumpBuffer = 0
        if (!jumpHeld && Body.vy[player] < -120) Body.vy[player] = -120 // let go early for a short hop
        if (strikeBuffer > 0 && attack < 0) {
          attack = 0
          strikeBuffer = 0
          swingHits.clear()
          sound.play(sounds.swing, { volume: 0.6, rate: 0.9 + Math.random() * 0.2 })
        }
      }
      step(player, dt, down && jumpHeld)
      if (attack >= 0) {
        attack += dt
        if (attack > 0.08) strike()
        if (attack >= ATTACK) attack = -1
      }
      // Spikes under the feet hurt and bounce you out.
      const feet = Position.y[player] + Body.foot[player]
      if (spikesAt(Position.x[player], feet - 2) || spikesAt(Position.x[player], feet + 1)) {
        hurt(Position.x[player] - facing, 2)
        Body.vy[player] = -260
      }
      if (Position.y[player] > map.height + 40) {
        hp = 0
        showHp()
        die()
      }
      for (const c of checkpoints) {
        if (run.checkpoint !== c && Math.abs(Position.x[player] - c.x) < 12 && Math.abs(feet - c.y) < 20) {
          run.checkpoint = c
          banner('checkpoint', 0x1f9e9a, 12)
          sound.play(sounds.pickup)
        }
      }
    }, 'fixed')

    /** The macuahuitl's reach in front of the player during the swing. */
    const strike = () => {
      // From just behind the player's center to the tip of the blade, so foes right on top of it are hit too.
      const reach = attack > 0.16 ? 34 : 26
      const cx = Position.x[player] + facing * (reach / 2 - 4)
      const cy = Position.y[player] + 2
      const hitBox = (e: Entity, w: number, h: number) => Math.abs(Position.x[e] - cx) < (reach + w) / 2 && Math.abs(Position.y[e] - cy) < (12 + h) / 2
      for (const f of foes.entities) {
        if (swingHits.has(f) || !hitBox(f, Sprite.w[f] - 4, Sprite.h[f] - 4)) continue
        swingHits.add(f)
        damageFoe(f)
      }
      for (const u of [...urns.entities]) {
        if (!hitBox(u, 12, 14)) continue
        sound.play(sounds.break)
        renderer.burst({ x: Position.x[u], y: Position.y[u], z: ACTORS, texture: textures.spark, tint: 0xb07850, size: 3, count: 12, speed: 70, gravity: 300, life: 0.5 })
        const kind = Urn.drop[u]
        const item = world.spawn(
          [Position, { x: Position.x[u], y: Position.y[u] - 4, z: ITEMS }],
          [Sprite, kind === HEART ? { w: 9, h: 9, texture: textures.heart } : { w: 10, h: 10, texture: textures.cacao }],
          [Pickup, { kind }],
        )
        tween(game, item, Position, { y: Position.y[u] - 2 }, { duration: 0.4, ease: ease.outBack })
        world.despawn(u)
      }
      if (boss.alive && !swingHits.has(boss.e) && hitBox(boss.e, 30, 26)) {
        swingHits.add(boss.e)
        damageBoss()
      }
    }

    const damageFoe = (f: Entity) => {
      Foe.hp[f]--
      Foe.flash[f] = 0.15
      Foe.awake[f] = 1
      sound.play(sounds.hit, { volume: 0.7 })
      if (world.has(f, Body)) Body.vx[f] = facing * 90
      if (Foe.hp[f] > 0) return
      renderer.burst({ x: Position.x[f], y: Position.y[f], z: ACTORS, texture: textures.spark, tint: Foe.kind[f] === BAT ? 0x7a4fa0 : 0xd8d0c0, size: 3, count: 16, speed: 90, gravity: 200, life: 0.6 })
      addScore(Foe.kind[f] === BAT ? 50 : 100)
      world.despawn(f)
    }

    // --- Foes ---------------------------------------------------------------------------------------------------------
    game.system((dt) => {
      const { x, y } = Position
      for (const f of foes.entities) {
        Foe.flash[f] = Math.max(0, Foe.flash[f] - dt)
        Sprite.tint[f] = Foe.flash[f] > 0 ? 0xff6a5a : 0xffffff
        const dx = x[player] - x[f]
        if (Foe.kind[f] === SKELETON) {
          if (Math.abs(dx) > 260) continue // asleep off screen
          // Patrol; turn at walls and at ledge edges. Close to the player, walk toward it a bit faster.
          const near = Math.abs(dx) < 90 && Math.abs(y[player] - y[f]) < 24
          // After touching the player a skeleton backs off for a moment instead of standing inside it.
          Foe.t[f] -= dt
          if (near && Foe.t[f] <= 0) Foe.dir[f] = Math.sign(dx) || 1
          const ahead = x[f] + Foe.dir[f] * 8
          const feet = y[f] + Body.foot[f]
          if (Body.grounded[f] && (!solidAt(ahead, feet + 4) && !ledgeAt(ahead, feet + 4) || solidAt(ahead, feet - 8))) Foe.dir[f] *= -1
          if (Foe.flash[f] <= 0) Body.vx[f] = Foe.dir[f] * (near ? 42 : 28)
          else Body.vx[f] *= 0.85
          step(f, dt, false)
          Sprite.flipX[f] = Foe.dir[f] < 0 ? 1 : 0
          Animation.count[f] = 2
          Animation.fps[f] = near ? 6 : 4
          if (spikesAt(x[f], feet + 1)) world.despawn(f)
        } else {
          // Bats hang until the player comes close, then swoop at it in waves.
          if (!Foe.awake[f]) {
            if (Math.abs(dx) < 100) (Foe.awake[f] = 1), (Animation.fps[f] = 10)
            continue
          }
          Foe.t[f] += dt
          const dy = y[player] - 2 - y[f]
          const d = Math.hypot(dx, dy) || 1
          x[f] += (dx / d) * 55 * dt
          y[f] += ((dy / d) * 55 + Math.sin(Foe.t[f] * 6) * 60) * dt
          Sprite.flipX[f] = dx < 0 ? 1 : 0
        }
        if (!dead && mercy <= 0 && overlapsBody(player, f, Sprite.w[f] - 6, Sprite.h[f] - 6)) {
          hurt(x[f])
          if (Foe.kind[f] === SKELETON) (Foe.dir[f] = -Math.sign(dx) || 1), (Foe.t[f] = 1)
        }
      }
      // Shards falling from the boss.
      for (const s of [...shards.entities]) {
        Shard.vy[s] = Math.min(Shard.vy[s] + GRAVITY * 0.5 * dt, 300)
        y[s] += Shard.vy[s] * dt
        if (solidAt(x[s], y[s] + 5)) {
          renderer.burst({ x: x[s], y: y[s] + 4, z: ACTORS, texture: textures.spark, tint: 0x7a4fa0, size: 2, count: 8, speed: 60, angle: -Math.PI / 2, spread: 2, gravity: 300, life: 0.4 })
          world.despawn(s)
        } else if (!dead && overlapsBody(player, s, 4, 8)) {
          hurt(x[s])
          world.despawn(s)
        }
      }
    }, 'fixed')

    /** Player hitbox (Body) against a box of `w`x`h` centered on another entity. */
    const overlapsBody = (p: Entity, e: Entity, w: number, h: number) => {
      const cy = Position.y[p] + Body.foot[p] - Body.h[p] / 2
      return Math.abs(Position.x[p] - Position.x[e]) < (Body.w[p] + w) / 2 && Math.abs(cy - Position.y[e]) < (Body.h[p] + h) / 2
    }

    // --- Pickups --------------------------------------------------------------------------------------------------------
    game.system(() => {
      for (const p of [...pickups.entities]) {
        if (!overlapsBody(player, p, 10, 10)) continue
        if (Pickup.kind[p] === HEART) (hp = Math.min(MAX_HP, hp + 2)), showHp()
        else addScore(250)
        sound.play(sounds.pickup)
        renderer.burst({ x: Position.x[p], y: Position.y[p], z: ACTORS, texture: textures.spark, tint: 0xf2c14e, size: 2, count: 10, speed: 50, life: 0.4 })
        world.despawn(p)
      }
    })

    // --- Boss: Itzpapalotl -----------------------------------------------------------------------------------------------
    const BOSS_HP = 16
    const boss = { e: -1, bar: -1, alive: false, hp: BOSS_HP, t: 0, mode: 'hover' as 'hover' | 'dive' | 'rise', flash: 0 }
    const arenaLeft = gateX + 24
    const arenaRight = map.width - 24
    const damageBoss = () => {
      boss.hp--
      boss.flash = 0.15
      shakeCamera(3)
      sound.play(sounds.hit, { rate: 0.8 })
      renderer.burst({ x: Position.x[boss.e], y: Position.y[boss.e], z: ACTORS, texture: textures.spark, tint: 0xd8d0c0, size: 3, count: 10, speed: 90, life: 0.4 })
      Sprite.w[boss.bar] = (180 * ui * boss.hp) / BOSS_HP
      Position.x[boss.bar] = (230 + (180 * boss.hp) / BOSS_HP / 2) * ui
      if (boss.hp > 0) return
      boss.alive = false
      addScore(5000)
      sound.play(sounds.boss, { rate: 1.5 })
      every(game, 0.15, () =>
        renderer.burst({ x: Position.x[boss.e] + (Math.random() - 0.5) * 40, y: Position.y[boss.e] + (Math.random() - 0.5) * 30, z: ACTORS, texture: textures.spark, tint: Math.random() < 0.5 ? 0x7a4fa0 : 0xf2c14e, size: 4, count: 14, speed: 120, life: 0.7 }),
      )
      tween(game, boss.e, Sprite, { alpha: 0 }, { duration: 2 })
      banner('Itzpapalotl falls', 0xf2c14e, 22)
      after(game, 3.5, () => void game.scene(end(true, run)))
    }

    // The gate closes behind the player and the boss wakes up.
    game.system(() => {
      if (gateClosed || Position.x[player] < gateX + 40) return
      gateClosed = true
      for (let ty = 0; ty < 15; ty++) {
        const block = world.spawn([Position, { x: gateX + 8, y: ty * 16 + 8, z: ACTORS }], [Sprite, { w: 16, h: 16, texture: textures.tiles, frame: 5, alpha: 0 }])
        tween(game, block, Sprite, { alpha: 1 }, { duration: 0.4 })
      }
      sound.play(sounds.boss)
      shakeCamera(8)
      banner('Itzpapalotl', 0x7a4fa0, 26)
      boss.e = world.spawn([Position, { x: bossSpot.x, y: -40, z: ACTORS }], [Sprite, { w: 48, h: 40, texture: textures.boss }], [Animation, { count: 2, fps: 5 }], [Interpolate])
      tween(game, boss.e, Position, { y: 150 }, { duration: 1.5, ease: ease.out, onDone: () => (boss.alive = true) })
      rect(228, 338, 184, 12, 0x0b0a0c, 0.8)
      boss.bar = rect(230, 340, 180, 8, 0x7a4fa0, 1, HUD)
    })

    let shardClock = 0
    game.system((dt) => {
      if (!boss.alive || dead) return
      const e = boss.e
      const { x, y } = Position
      boss.t += dt
      boss.flash = Math.max(0, boss.flash - dt)
      Sprite.tint[e] = boss.flash > 0 ? 0xff6a5a : 0xffffff
      const angry = boss.hp <= BOSS_HP / 2
      if (boss.mode === 'hover') {
        // Drift in a figure eight over the arena, dropping obsidian shards.
        const mid = (arenaLeft + arenaRight) / 2
        const span = (arenaRight - arenaLeft) / 2 - 30
        const tx = mid + Math.sin(boss.t * 0.7) * span
        const ty = 140 + Math.sin(boss.t * 1.4) * 18
        x[e] += (tx - x[e]) * Math.min(1, dt * 2)
        y[e] += (ty - y[e]) * Math.min(1, dt * 2)
        shardClock -= dt
        if (shardClock <= 0) {
          shardClock = angry ? 1.1 : 1.8
          for (const off of angry ? [-14, 0, 14] : [-10, 10]) world.spawn([Position, { x: x[e] + off, y: y[e] + 12, z: ACTORS }], [Sprite, { w: 6, h: 10, texture: textures.shard }], [Shard])
        }
        if (boss.t > (angry ? 4 : 6)) (boss.mode = 'dive'), (boss.t = 0), sound.play(sounds.boss, { rate: 1.3, volume: 0.6 })
      } else if (boss.mode === 'dive') {
        // Swoop down at the player: the moment to strike it from the ground.
        const tx = Position.x[player]
        const ty = map.height - 48
        x[e] += (tx - x[e]) * Math.min(1, dt * 2.5)
        y[e] += (ty - y[e]) * Math.min(1, dt * 3)
        if (boss.t > 1.4) (boss.mode = 'rise'), (boss.t = 0)
      } else {
        y[e] += (140 - y[e]) * Math.min(1, dt * 2)
        if (boss.t > 1.2) (boss.mode = 'hover'), (boss.t = 0)
      }
      Sprite.flipX[e] = Position.x[player] < x[e] ? 1 : 0
      if (overlapsBody(player, e, 34, 24)) hurt(x[e])
    }, 'fixed')

    // --- Player animation (frames: 0 idle, 1-4 run, 5 jump, 6-8 swing, 9 hurt, 10 crouch) ------------------------------------
    game.system(() => {
      if (dead) return
      const grounded = Body.grounded[player] === 1
      const [first, count, fps] =
        stun > 0 ? [9, 1, 1]
        : attack >= 0 ? [attack < 0.08 ? 6 : attack < 0.16 ? 7 : 8, 1, 1]
        : !grounded ? [5, 1, 1]
        : down ? [10, 1, 1]
        : Body.vx[player] ? [1, 4, 10]
        : [0, 1, 1]
      if (Animation.start[player] !== first) (Animation.start[player] = first), (Animation.time[player] = 0)
      Animation.count[player] = count
      Animation.fps[player] = fps
      Sprite.flipX[player] = facing < 0 ? 1 : 0
      Sprite.alpha[player] = mercy > 0 && Math.floor(mercy * 12) % 2 ? 0.35 : 1
    })

  }

export const end =
  (won: boolean, run: Run): Scene =>
  async (game) => {
    const { map, sounds, text, rect, follow, snap } = await load(game)
    const input = game.get(Input)
    let t = 0
    game.system((dt) => (t += dt))
    snap(map.width)
    follow(() => map.width - 200 - (1 - Math.cos(t * 0.1)) * 400)
    rect(0, 80, 640, 110, 0x0b0a0c, 0.7)
    text(won ? 'the dead rest easy' : 'Mictlan keeps you', { x: 320, y: 96, size: 28, tint: won ? 0xf2c14e : 0xb5302a })
    text(`score ${run.score}`, { x: 320, y: 150, size: 13, tint: 0xf3e6c9 })
    const prompt = text('press enter or tap to play again', { x: 320, y: 300, size: 11, tint: 0x1f9e9a })
    every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))
    let ready = false
    after(game, 1, () => (ready = true))
    game.system(() => {
      if (!ready || !confirmed(input)) return
      game.get(Audio).play(sounds.start)
      void game.scene(menu)
    })
  }
