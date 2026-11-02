import {
  after,
  Animation,
  Audio,
  Camera,
  defineComponent,
  ease,
  every,
  f32,
  hit,
  Input,
  loadTilemap,
  Position,
  Renderer,
  Rotation,
  spawnText,
  Sprite,
  tween,
  u32,
  u8,
  type Entity,
  type Game,
  type Scene,
  type TextOptions,
  type Tilemap,
} from '../../src'

// Ocelotl: a jaguar warrior holds the temple plaza against five waves of tzitzimime (star demons that walk around
// walls) and tzinacan bats (that fly over them). Isometric Tiled map with a y-sorted props layer.

/** Map layers from the Tiled file: ground (0), props (1, y-sorted, actors live here), spawns (2). */
const GROUND = 0
const PROPS = 1
const SHADOWS = 0.5
const FLYERS = 1.5
const HUD = 100
const PANELS = 99

const WAVES = [
  { walkers: 5, bats: 0 },
  { walkers: 7, bats: 3 },
  { walkers: 10, bats: 5 },
  { walkers: 12, bats: 8 },
  { walkers: 16, bats: 12 },
]
const MAX_HP = 5

interface Run {
  score: number
  wave: number
}

const WALKER = 0
const BAT = 1
/** `ground` is how far below `Position.y` the foe touches the ground (its feet, or its shadow for bats). */
const Foe = defineComponent({ kind: u8, hp: u8, speed: f32, ground: f32, shadow: u32, flash: f32 })
/** `ground` is how far below the dart its shadow (and its collision point) is. */
const Dart = defineComponent({ vx: f32, vy: f32, life: f32, ground: f32, shadow: u32 })

const url = (file: string) => new URL(`./${file}`, import.meta.url).href
const art = (file: string, w: number, h: number) => [url(file), { frameWidth: w, frameHeight: h, filter: 'nearest' }] as const

async function load(game: Game) {
  const renderer = game.get(Renderer)
  const [map, textures, sounds, font] = await Promise.all([
    loadTilemap(game, url('map.tmj')),
    renderer.loadTextures({
      ocelotl: art('ocelotl.png', 16, 24),
      walker: art('tzitzimitl.png', 16, 20),
      bat: art('tzinacan.png', 16, 12),
      dart: art('dart.png', 12, 4),
      shadow: art('shadow.png', 16, 6),
      heart: art('heart.png', 9, 9),
      spark: url('spark.png'),
    }),
    game.get(Audio).load({
      throw: url('throw.wav'),
      hit: url('hit.wav'),
      hurt: url('hurt.wav'),
      wave: url('wave.wav'),
      pickup: url('pickup.wav'),
      start: url('start.wav'),
    }),
    renderer.loadFont({ family: 'ui-monospace, monospace', size: 48, weight: 'bold' }),
  ])
  renderer.ySort.add(PROPS)
  renderer.screen.add(HUD)
  renderer.screen.add(PANELS)
  /** UI pixels: the HUD is laid out for a 640x360 screen and scaled to the canvas. */
  const ui = game.canvas.height / 360
  const text = (value: string, options: TextOptions) =>
    spawnText(game.world, font, value, { z: HUD, align: 'center', ...options, x: (options.x ?? 0) * ui, y: (options.y ?? 0) * ui, size: (options.size ?? 12) * ui })
  /** A dark band behind text, in UI pixels: a Sprite without a texture is a solid rectangle. */
  const panel = (y: number, h: number) =>
    game.world.spawn([Position, { x: game.canvas.width / 2, y: (y + h / 2) * ui, z: PANELS }], [Sprite, { w: game.canvas.width, h: h * ui, tint: 0x0b0a0c, alpha: 0.6 }])
  return { map, textures, sounds, text, ui, panel }
}

/** The camera eases toward a target, stays inside the map and shakes when asked. */
function camera(game: Game, map: Tilemap, target: () => { x: number; y: number }) {
  const cam = game.get(Camera)
  let x = target().x
  let y = target().y
  let shake = 0
  game.system((dt) => {
    cam.zoom = game.canvas.height / 300
    const t = target()
    x += (t.x - x) * Math.min(1, dt * 5)
    y += (t.y - y) * Math.min(1, dt * 5)
    const hw = cam.width / 2 / cam.zoom
    const hh = cam.height / 2 / cam.zoom
    shake = Math.max(0, shake - dt * 30)
    cam.x = Math.min(Math.max(x, hw), map.width - hw) + (Math.random() - 0.5) * shake
    cam.y = Math.min(Math.max(y, hh), map.height - hh) + (Math.random() - 0.5) * shake
  })
  return { shake: (amount: number) => (shake = Math.max(shake, amount)) }
}

const confirmed = (input: Input) => ['Space', 'Enter', 'Pointer', 'Button0', 'Button9'].some((key) => input.pressed.has(key))

export const menu: Scene = async (game) => {
  const { map, textures, sounds, text, panel } = await load(game)
  const input = game.get(Input)
  panel(50, 120)
  panel(280, 46)
  // A slow pan over the plaza behind the title.
  let t = 0
  camera(game, map, () => ({ x: map.width / 2 + Math.cos(t) * 200, y: map.height / 2 + Math.sin(t) * 80 }))
  game.system((dt) => (t += dt * 0.15))
  for (let i = 0; i < 6; i++) {
    const o = map.objects.filter((o) => o.type === 'spawner')[i]
    game.world.spawn([Position, { x: o.x, y: o.y - 10, z: PROPS }], [Sprite, { w: 16, h: 20, texture: textures.walker }], [Animation, { count: 2, fps: 3 }])
  }

  text('OCELOTL', { x: 320, y: 70, size: 56, tint: 0xf2c14e })
  text('hold the temple plaza until the fifth dawn', { x: 320, y: 140, size: 12, tint: 0xf3e6c9 })
  text('move: arrows / WASD / stick / hold a finger · throw: space / J / gamepad A', { x: 320, y: 290, size: 9, tint: 0xf3e6c9, alpha: 0.8 })
  const prompt = text('press space or tap to start', { x: 320, y: 312, size: 11, tint: 0x1f9e9a })
  every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))

  game.system(() => {
    if (!confirmed(input)) return
    game.get(Audio).play(sounds.start)
    void game.scene(battle({ score: 0, wave: 0 }))
  })
}

export const battle =
  (run: Run): Scene =>
  async (game) => {
    const { map, textures, sounds, text, ui, panel } = await load(game)
    panel(0, 26)
    const { world } = game
    const input = game.get(Input)
    const sound = game.get(Audio)
    const renderer = game.get(Renderer)

    /** Walls, trees and stelae block anything that walks; so does the outside of the map. */
    const solid = (x: number, y: number) => map.tileAt('props', x, y) >= 0 || map.tileAt('ground', x, y) < 0

    const W = 16
    const H = 24
    const start = map.objects.find((o) => o.name === 'player')!
    const player = world.spawn(
      [Position, { x: start.x, y: start.y - H / 2, z: PROPS }],
      [Sprite, { w: W, h: H, texture: textures.ocelotl }],
      [Animation, { count: 1 }],
    )
    const playerShadow = world.spawn([Position, { z: SHADOWS }], [Sprite, { w: 14, h: 5, texture: textures.shadow }])
    const view = camera(game, map, () => ({ x: Position.x[player], y: Position.y[player] }))

    let hp = MAX_HP
    let mercy = 0
    let over = false
    let faceX = 1
    let faceY = 0
    let cooldown = 0
    let throwing = 0

    // HUD in canvas pixels.
    const hearts: Entity[] = []
    const showHp = () => {
      for (const e of hearts.splice(0)) world.despawn(e)
      for (let i = 0; i < MAX_HP; i++)
        hearts.push(
          world.spawn(
            [Position, { x: (14 + i * 12) * ui, y: 14 * ui, z: HUD }],
            [Sprite, { w: 9 * ui, h: 9 * ui, texture: textures.heart, alpha: i < hp ? 1 : 0.2 }],
          ),
        )
    }
    showHp()
    const waveText = text('', { x: 320, y: 8, size: 11, tint: 0xf3e6c9 })
    const scoreText = text('', { x: 630, y: 8, size: 11, tint: 0xf2c14e, align: 'right' })
    const showScore = () => scoreText.set(`${run.score}`)
    showScore()
    const banner = (value: string, tint = 0xf2c14e) => {
      const t = text(value, { x: 320, y: 120, size: 22, tint })
      after(game, 1.6, () => t.entities.forEach((e) => tween(game, e, Sprite, { alpha: 0 }, { duration: 0.5, onDone: () => world.despawn(e) })))
    }

    // --- Waves -------------------------------------------------------------------------------------------------------
    const spawners = map.objects.filter((o) => o.type === 'spawner')
    const foes = world.query(Foe)
    let pending = 0
    const startWave = () => {
      const config = WAVES[run.wave]
      waveText.set(`wave ${run.wave + 1}/${WAVES.length}`)
      banner(run.wave === WAVES.length - 1 ? 'the last night' : `wave ${run.wave + 1}`)
      sound.play(sounds.wave)
      const queue = [...Array(config.walkers).fill(WALKER), ...Array(config.bats).fill(BAT)].sort(() => Math.random() - 0.5)
      pending = queue.length
      const spawnNext = () => {
        if (over) return
        const kind = queue.pop()
        if (kind === undefined) return
        pending--
        // The spawner farthest from the player, so foes never pop up next to it.
        const far = [...spawners].sort((a, b) => dist(b) - dist(a)).slice(0, 3)
        const o = far[Math.floor(Math.random() * far.length)]
        spawnFoe(kind, o.x + (Math.random() - 0.5) * 12, o.y + (Math.random() - 0.5) * 6)
        after(game, Math.max(0.2, 0.7 - run.wave * 0.1) + Math.random() * 0.4, spawnNext)
      }
      after(game, 1.5, spawnNext)
    }
    const dist = (o: { x: number; y: number }) => Math.hypot(o.x - Position.x[player], o.y - Position.y[player])

    const spawnFoe = (kind: number, x: number, ground: number) => {
      const bat = kind === BAT
      const h = bat ? 12 : 20
      const lift = bat ? 18 : h / 2 // bats fly 18 px over their shadow
      const shadow = world.spawn([Position, { x, y: ground, z: SHADOWS }], [Sprite, { w: bat ? 10 : 12, h: 4, texture: textures.shadow, alpha: 0 }])
      const e = world.spawn(
        [Position, { x, y: ground - lift, z: bat ? FLYERS : PROPS }],
        [Sprite, { w: 16, h, texture: bat ? textures.bat : textures.walker, alpha: 0 }],
        [Animation, { count: 2, fps: bat ? 8 : 4, time: Math.random() }],
        [Foe, { kind, hp: bat ? 1 : run.wave < 2 ? 2 : 3, speed: (bat ? 55 : 32) + run.wave * 5 + Math.random() * 8, ground: lift, shadow }],
      )
      tween(game, e, Sprite, { alpha: 1 }, { duration: 0.6 })
      tween(game, shadow, Sprite, { alpha: 1 }, { duration: 0.6 })
    }

    // --- Player ------------------------------------------------------------------------------------------------------
    const SPEED = 80
    /** Moves `e` by (dx, dy) one axis at a time so it slides along walls; tests the feet at `ground` px below. */
    const move = (e: Entity, dx: number, dy: number, ground: number, half: number) => {
      const { x, y } = Position
      const blocked = (px: number, py: number) => solid(px - half, py + ground) || solid(px + half, py + ground)
      let moved = 0
      if (dx && !blocked(x[e] + dx, y[e])) (x[e] += dx), moved++
      if (dy && !blocked(x[e], y[e] + dy)) (y[e] += dy), moved++
      return moved
    }

    game.system((dt) => {
      if (over) return
      const { keys, pointers } = input
      const pad = input.gamepads.find((p) => p)
      const key = (a: string, b: string) => Number(keys.has(a) || keys.has(b))
      const button = (i: number) => Number(!!pad?.buttons[i]?.pressed)
      const stick = (i: number) => (Math.abs(pad?.axes[i] ?? 0) > 0.2 ? pad!.axes[i] : 0)
      let dx = key('ArrowRight', 'KeyD') - key('ArrowLeft', 'KeyA') + button(15) - button(14) + stick(0)
      let dy = key('ArrowDown', 'KeyS') - key('ArrowUp', 'KeyW') + button(13) - button(12) + stick(1)
      const [finger] = pointers.values()
      if (finger) {
        const target = game.get(Camera).toWorld(finger.x, finger.y)
        dx = target.x - Position.x[player]
        dy = target.y - Position.y[player]
        if (Math.hypot(dx, dy) < 6) dx = dy = 0
      }
      const length = Math.hypot(dx, dy)
      if (length) {
        faceX = dx / length
        faceY = dy / length
        const step = (SPEED * dt) / Math.max(1, length)
        move(player, dx * step, dy * step * 0.75, H / 2 - 1, 4) // isometric: vertical moves cover less ground
        Sprite.flipX[player] = dx < 0 ? 1 : dx > 0 ? 0 : Sprite.flipX[player]
      }

      // Throw: auto-aims at the nearest foe in range, otherwise straight ahead. Holding a finger keeps throwing.
      cooldown -= dt
      throwing -= dt
      const wantsThrow = keys.has('Space') || keys.has('KeyJ') || button(0) || button(2) || button(7) || !!finger
      if (wantsThrow && cooldown <= 0) {
        let aimX = faceX
        let aimY = faceY
        let best = 120
        for (const f of foes.entities) {
          const d = Math.hypot(Position.x[f] - Position.x[player], Position.y[f] - Position.y[player])
          if (d < best) (best = d), (aimX = (Position.x[f] - Position.x[player]) / d), (aimY = (Position.y[f] - Position.y[player]) / d)
        }
        if (!finger || best < 120) throwDart(aimX, aimY)
      }

      // Frames: 0 idle, 1-4 walk, 5 throw.
      const [start, count] = throwing > 0 ? [5, 1] : length ? [1, 4] : [0, 1]
      if (Animation.start[player] !== start) (Animation.start[player] = start), (Animation.time[player] = 0)
      Animation.count[player] = count
      Animation.fps[player] = 10
    })

    const DART_SPEED = 260
    const throwDart = (ax: number, ay: number) => {
      cooldown = 0.3
      throwing = 0.15
      Sprite.flipX[player] = ax < 0 ? 1 : 0
      const x = Position.x[player] + ax * 6
      const y = Position.y[player] - 2 + ay * 6
      const lift = H / 2 + 1 // thrown from the chest, flies at that height over its shadow
      const shadow = world.spawn([Position, { x, y: y + lift, z: SHADOWS }], [Sprite, { w: 8, h: 3, texture: textures.shadow, alpha: 0.6 }])
      world.spawn(
        [Position, { x, y, z: PROPS }],
        [Sprite, { w: 12, h: 4, texture: textures.dart }],
        [Rotation, { angle: Math.atan2(ay, ax) }],
        [Dart, { vx: ax * DART_SPEED, vy: ay * DART_SPEED, life: 0.9, ground: lift, shadow }],
      )
      sound.play(sounds.throw, { rate: 0.9 + Math.random() * 0.2, volume: 0.5 })
    }

    // --- Darts -------------------------------------------------------------------------------------------------------
    const darts = world.query(Dart)
    const removeDart = (d: Entity) => {
      world.despawn(Dart.shadow[d])
      world.despawn(d)
    }
    game.system((dt) => {
      const { x, y } = Position
      for (const d of [...darts.entities]) {
        x[d] += Dart.vx[d] * dt
        y[d] += Dart.vy[d] * dt
        Position.x[Dart.shadow[d]] = x[d]
        Position.y[Dart.shadow[d]] = y[d] + Dart.ground[d]
        Dart.life[d] -= dt
        if (Dart.life[d] <= 0 || solid(x[d], y[d] + Dart.ground[d])) {
          if (Dart.life[d] > 0) renderer.burst({ x: x[d], y: y[d], z: PROPS, texture: textures.spark, tint: 0xb7aa9e, size: 2, count: 6, speed: 50, life: 0.3 })
          removeDart(d)
          continue
        }
        // ponytail: hit() is a linear scan, so this is darts x foes; fine at ~10 darts and ~30 foes (measured: <0.05 ms)
        const f = hit(d, foes.entities, 1)
        if (f < 0) continue
        removeDart(d)
        damage(f, Dart.vx[d], Dart.vy[d])
      }
    })

    const damage = (f: Entity, vx: number, vy: number) => {
      Foe.hp[f]--
      Foe.flash[f] = 0.12
      // Knockback along the dart's path.
      move(f, vx * 0.03, vy * 0.03, Foe.ground[f], 4)
      if (Foe.hp[f] > 0) return sound.play(sounds.hit, { volume: 0.6 })
      sound.play(sounds.hit, { rate: 0.7 })
      renderer.burst({ x: Position.x[f], y: Position.y[f], z: PROPS, texture: textures.spark, tint: Foe.kind[f] === BAT ? 0x7a4fa0 : 0x6ff2e8, size: 3, count: 14, speed: 80, life: 0.5 })
      run.score += Foe.kind[f] === BAT ? 15 : 10
      showScore()
      if (Math.random() < 0.12 && hp < MAX_HP) dropHeart(Position.x[f], Position.y[f] + Foe.ground[f] - 5)
      world.despawn(Foe.shadow[f])
      world.despawn(f)
    }

    const pickups: Entity[] = []
    const dropHeart = (x: number, y: number) => {
      const e = world.spawn([Position, { x, y, z: PROPS }], [Sprite, { w: 9, h: 9, texture: textures.heart }])
      pickups.push(e)
      tween(game, e, Position, { y: y - 4 }, { duration: 0.3, ease: ease.out })
    }

    // --- Foes --------------------------------------------------------------------------------------------------------
    // Walkers follow a flow field: a breadth-first search over the map's cells from the player's cell, redone when the
    // player changes cell, so every walker knows which neighbor cell is one step closer, around walls and trees.
    const { cols, rows } = map
    const blocked = new Uint8Array(cols * rows)
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const c = map.cellCenter(col, row)
        blocked[row * cols + col] = solid(c.x, c.y) ? 1 : 0
      }
    const steps = new Int32Array(cols * rows)
    const queue = new Int32Array(cols * rows)
    const NEIGHBORS = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    let fieldFrom = -1
    const cellIndex = (px: number, py: number) => {
      const { col, row } = map.cellAt(px, py)
      return col < 0 || row < 0 || col >= cols || row >= rows ? -1 : row * cols + col
    }
    const updateField = () => {
      const from = cellIndex(Position.x[player], Position.y[player] + H / 2 - 1)
      if (from < 0 || from === fieldFrom) return
      fieldFrom = from
      steps.fill(-1)
      steps[from] = 0
      let head = 0
      let tail = 0
      queue[tail++] = from
      while (head < tail) {
        const k = queue[head++]
        const col = k % cols
        const row = (k - col) / cols
        for (const [dc, dr] of NEIGHBORS) {
          const c = col + dc
          const r = row + dr
          const n = r * cols + c
          if (c < 0 || r < 0 || c >= cols || r >= rows || blocked[n] || steps[n] >= 0) continue
          steps[n] = steps[k] + 1
          queue[tail++] = n
        }
      }
    }
    /** Where a walker standing at (px, py) should head: the center of the next cell toward the player, or the player. */
    const nextStep = (px: number, py: number) => {
      const k = cellIndex(px, py)
      if (k < 0 || steps[k] <= 1) return { x: Position.x[player], y: Position.y[player] + H / 2 }
      const col = k % cols
      const row = (k - col) / cols
      for (const [dc, dr] of NEIGHBORS) {
        const n = (row + dr) * cols + col + dc
        if (col + dc >= 0 && col + dc < cols && row + dr >= 0 && row + dr < rows && steps[n] === steps[k] - 1) return map.cellCenter(col + dc, row + dr)
      }
      return map.cellCenter(col, row)
    }

    game.system((dt) => {
      const { x, y } = Position
      const list = foes.entities
      updateField()
      for (const f of list) {
        const bat = Foe.kind[f] === BAT
        const feet = y[f] + Foe.ground[f]
        const target = bat ? { x: x[player], y: y[player] + H / 2 } : nextStep(x[f], feet - 1)
        let dx = target.x - x[f]
        let dy = target.y - feet
        const d = Math.hypot(dx, dy) || 1
        dx /= d
        dy /= d
        // Keep a little space from each other so crowds spread around the player.
        for (const o of list) {
          if (o === f) continue
          const ox = x[f] - x[o]
          const oy = y[f] - y[o]
          const od = ox * ox + oy * oy
          if (od < 144 && od > 0) (dx += ox / od * 3), (dy += oy / od * 3)
        }
        const step = Foe.speed[f] * dt
        if (bat) {
          const wobble = Math.sin(Animation.time[f] * 5) * 0.6
          x[f] += (dx - dy * wobble) * step
          y[f] += (dy + dx * wobble) * step * 0.75
        } else if (!move(f, dx * step, dy * step * 0.75, Foe.ground[f] - 1, 4)) {
          // Clipping a corner on the way to the next cell: step back toward the middle of the current one.
          const c = map.cellAt(x[f], feet - 1)
          const home = map.cellCenter(c.col, c.row)
          const hx = home.x - x[f]
          const hy = home.y - feet
          const hd = Math.hypot(hx, hy) || 1
          move(f, (hx / hd) * step, (hy / hd) * step, Foe.ground[f] - 1, 4)
        }
        Sprite.flipX[f] = x[player] < x[f] ? 1 : 0
        Foe.flash[f] = Math.max(0, Foe.flash[f] - dt)
        Sprite.tint[f] = Foe.flash[f] > 0 ? 0xff5a4a : 0xffffff
        Position.x[Foe.shadow[f]] = x[f]
        Position.y[Foe.shadow[f]] = y[f] + Foe.ground[f]
      }
      Position.x[playerShadow] = x[player]
      Position.y[playerShadow] = y[player] + H / 2 - 1
    })

    // --- Contact, pickups and the end of a wave ------------------------------------------------------------------------
    let resting = false
    game.system((dt) => {
      if (over) return
      mercy -= dt
      Sprite.alpha[player] = mercy > 0 && Math.floor(mercy * 10) % 2 ? 0.3 : 1

      const heart = hit(player, pickups, 1)
      if (heart >= 0) {
        pickups.splice(pickups.indexOf(heart), 1)
        world.despawn(heart)
        hp = Math.min(MAX_HP, hp + 1)
        showHp()
        sound.play(sounds.pickup)
      }

      const f = mercy > 0 ? -1 : hit(player, foes.entities, 4)
      if (f >= 0) {
        hp--
        mercy = 1.2
        showHp()
        view.shake(8)
        sound.play(sounds.hurt)
        renderer.burst({ x: Position.x[player], y: Position.y[player], z: PROPS, texture: textures.spark, tint: 0xb5302a, size: 3, count: 16, speed: 90, life: 0.5 })
        // Knock the player away from the foe.
        const kx = Position.x[player] - Position.x[f]
        const ky = Position.y[player] - Position.y[f]
        const k = Math.hypot(kx, ky) || 1
        for (let i = 0; i < 6; i++) move(player, (kx / k) * 3, (ky / k) * 3, H / 2 - 1, 4)
        if (hp <= 0) {
          over = true
          tween(game, player, Sprite, { alpha: 0 }, { duration: 1, onDone: () => void game.scene(end(false, run)) })
          return
        }
      }

      if (!resting && pending === 0 && foes.entities.length === 0) {
        resting = true
        run.wave++
        if (run.wave === WAVES.length) {
          over = true
          banner('the sun rises')
          after(game, 2.5, () => void game.scene(end(true, run)))
          return
        }
        after(game, 2, () => {
          resting = false
          startWave()
        })
      }
    })

    startWave()
  }

export const end =
  (won: boolean, run: Run): Scene =>
  async (game) => {
    const { map, sounds, text, panel } = await load(game)
    panel(80, 110)
    panel(290, 30)
    const input = game.get(Input)
    let t = 0
    camera(game, map, () => ({ x: map.width / 2 + Math.cos(t) * 200, y: map.height / 2 + Math.sin(t) * 80 }))
    game.system((dt) => (t += dt * 0.15))

    text(won ? 'the plaza holds' : 'the night swallows the plaza', { x: 320, y: 100, size: 24, tint: won ? 0xf2c14e : 0xb5302a })
    text(`score ${run.score} · reached wave ${Math.min(run.wave + 1, WAVES.length)}`, { x: 320, y: 160, size: 12, tint: 0xf3e6c9 })
    const prompt = text('press space or tap to play again', { x: 320, y: 300, size: 11, tint: 0x1f9e9a })
    every(game, 0.5, () => (prompt.alpha = prompt.alpha ? 0 : 1))

    let ready = false
    after(game, 0.8, () => (ready = true))
    game.system(() => {
      if (!ready || !confirmed(input)) return
      game.get(Audio).play(sounds.start)
      void game.scene(menu)
    })
  }
