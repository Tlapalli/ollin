import { Application, Assets, Container, Particle, ParticleContainer, Sprite } from 'pixi.js'
import { COUNT, GRAVITY, HEIGHT, measure, SIZE, SPEED, WIDTH } from './bench'
import glyph from './glyph.png'

// ?mode=particle uses a ParticleContainer (PixiJS's fast path for many simple sprites, position-only updates);
// the default is the idiomatic version: one Sprite per bunny in a Container.
const particle = new URLSearchParams(location.search).get('mode') === 'particle'

const app = new Application()
await app.init({
  canvas: document.querySelector('canvas')!,
  width: WIDTH,
  height: HEIGHT,
  background: '#1a1a1a',
  preference: 'webgl',
  antialias: false,
})
const texture = await Assets.load(glyph)
const scale = SIZE / texture.width

type Bunny = { item: { x: number; y: number }; vx: number; vy: number }
const bunnies: Bunny[] = []
const layer = particle ? new ParticleContainer({ dynamicProperties: { position: true } }) : new Container()
app.stage.addChild(layer)

for (let n = 0; n < COUNT; n++) {
  const x = Math.random() * WIDTH
  const y = Math.random() * HEIGHT
  let item: { x: number; y: number }
  if (layer instanceof ParticleContainer) {
    const p = new Particle({ texture, x, y, scaleX: scale, scaleY: scale, anchorX: 0.5, anchorY: 0.5 })
    layer.addParticle(p)
    item = p
  } else {
    const s = new Sprite({ texture, x, y, anchor: 0.5, width: SIZE, height: SIZE })
    layer.addChild(s)
    item = s
  }
  bunnies.push({ item, vx: (Math.random() - 0.5) * SPEED, vy: (Math.random() - 0.5) * SPEED })
}

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 0.1)
  const min = SIZE / 2
  const maxX = WIDTH - min
  const maxY = HEIGHT - min
  for (const b of bunnies) {
    const it = b.item
    b.vy += GRAVITY * dt
    it.x += b.vx * dt
    it.y += b.vy * dt
    if (it.x < min || it.x > maxX) {
      b.vx *= -1
      it.x = Math.min(Math.max(it.x, min), maxX)
    }
    if (it.y > maxY) {
      b.vy *= -0.85
      it.y = maxY
    }
  }
})

measure()
