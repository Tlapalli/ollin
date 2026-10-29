import Phaser from 'phaser'
import { COUNT, GRAVITY, HEIGHT, measure, SIZE, SPEED, WIDTH } from './bench'
import glyph from './glyph.png'

// The idiomatic Phaser version: one Image game object per sprite, moved in Scene.update.
type Bunny = { image: Phaser.GameObjects.Image; vx: number; vy: number }

class Bench extends Phaser.Scene {
  bunnies: Bunny[] = []

  preload() {
    this.load.image('glyph', glyph)
  }

  create() {
    for (let n = 0; n < COUNT; n++) {
      const image = this.add.image(Math.random() * WIDTH, Math.random() * HEIGHT, 'glyph').setDisplaySize(SIZE, SIZE)
      this.bunnies.push({ image, vx: (Math.random() - 0.5) * SPEED, vy: (Math.random() - 0.5) * SPEED })
    }
    measure()
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.1)
    const min = SIZE / 2
    const maxX = WIDTH - min
    const maxY = HEIGHT - min
    for (const b of this.bunnies) {
      const img = b.image
      b.vy += GRAVITY * dt
      img.x += b.vx * dt
      img.y += b.vy * dt
      if (img.x < min || img.x > maxX) {
        b.vx *= -1
        img.x = Math.min(Math.max(img.x, min), maxX)
      }
      if (img.y > maxY) {
        b.vy *= -0.85
        img.y = maxY
      }
    }
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  canvas: document.querySelector('canvas')!,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#1a1a1a',
  banner: false,
  scene: Bench,
})
