import Phaser from 'phaser'
import { COUNT, GRAVITY, HEIGHT, measure, SIZE, SPEED, WIDTH } from './bench'
import glyph from './glyph.png'

// Phaser 4's SpriteGPULayer: one GPU buffer, one draw call.
// ?mode=gpu (default): motion is a looping tween evaluated in the shader, so the CPU does nothing per frame.
//   It cannot collide or react to game logic; it approximates the bounce with Linear x and Quad y yoyos.
// ?mode=cpu: the same CPU simulation as the other pages, pushed with editMember every frame.
const MODE = new URLSearchParams(location.search).get('mode') ?? 'gpu'

class Bench extends Phaser.Scene {
  layer!: Phaser.GameObjects.SpriteGPULayer
  px = new Float32Array(COUNT)
  py = new Float32Array(COUNT)
  vx = new Float32Array(COUNT)
  vy = new Float32Array(COUNT)

  preload() {
    this.load.image('glyph', glyph)
  }

  create() {
    const scale = SIZE / this.textures.getFrame('glyph').width
    this.layer = this.add.spriteGPULayer('glyph', COUNT)
    const member: Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member> = { scaleX: scale, scaleY: scale }
    for (let n = 0; n < COUNT; n++) {
      this.px[n] = Math.random() * WIDTH
      this.py[n] = Math.random() * HEIGHT
      this.vx[n] = (Math.random() - 0.5) * SPEED
      this.vy[n] = (Math.random() - 0.5) * SPEED
      if (MODE === 'gpu') {
        member.x = { base: SIZE / 2, amplitude: WIDTH - SIZE, duration: 1000 + Math.random() * 2000, delay: Math.random() * 3000, ease: 'Linear', yoyo: true, loop: true }
        member.y = { base: HEIGHT - SIZE / 2, amplitude: -Math.random() * HEIGHT * 0.8, duration: 400 + Math.random() * 600, delay: Math.random() * 1000, ease: 'Quad.easeOut', yoyo: true, loop: true }
      } else {
        member.x = this.px[n]
        member.y = this.py[n]
      }
      this.layer.addMember(member)
    }
    measure()
  }

  update(_time: number, delta: number) {
    if (MODE === 'gpu') return
    const dt = Math.min(delta / 1000, 0.1)
    const min = SIZE / 2
    const maxX = WIDTH - min
    const maxY = HEIGHT - min
    const { px: x, py: y, vx, vy } = this
    const edit = { x: 0, y: 0 }
    for (let n = 0; n < COUNT; n++) {
      vy[n] += GRAVITY * dt
      x[n] += vx[n] * dt
      y[n] += vy[n] * dt
      if (x[n] < min || x[n] > maxX) {
        vx[n] *= -1
        x[n] = Math.min(Math.max(x[n], min), maxX)
      }
      if (y[n] > maxY) {
        vy[n] *= -0.85
        y[n] = maxY
      }
      edit.x = x[n]
      edit.y = y[n]
      this.layer.editMember(n, edit)
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
