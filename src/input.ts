import { token, type Plugin } from './core'

export interface Point {
  x: number
  y: number
}

export interface Input {
  /** Pressed keys by `KeyboardEvent.code` ('KeyA', 'Space', 'ArrowLeft'...). */
  keys: Set<string>
  /**
   * What went down this frame only: key codes, `'Pointer'` for a click or tap, and `'Button0'`–`'Button16'` for gamepad
   * buttons (any pad). For one-shot actions (jump, start, menu) without tracking the previous state yourself.
   * Read it in `update` systems; it is cleared at the end of every frame.
   */
  pressed: Set<string>
  /** The last pointer (mouse, pen or finger) that moved, in canvas pixels. `down` while any pointer is pressed. */
  pointer: Point & { down: boolean }
  /** Every pressed pointer by `pointerId`, in canvas pixels: one entry per finger for multi-touch controls. */
  pointers: Map<number, Point>
  /**
   * Connected gamepads (Gamepad API), refreshed each frame. With the standard mapping, `buttons[0]` is the bottom face
   * button (A / cross), `buttons[9]` start, `buttons[12..15]` the d-pad (up, down, left, right) and `axes[0]`/`axes[1]`
   * the left stick. Refreshed at the start of `update`.
   */
  gamepads: (Gamepad | null)[]
}

export const Input = token<Input>('Input')

export const input = (): Plugin => (game) => {
  const state: Input = { keys: new Set(), pressed: new Set(), pointer: { x: 0, y: 0, down: false }, pointers: new Map(), gamepads: [] }
  const { canvas } = game
  // Fingers on the canvas control the game instead of scrolling or zooming the page.
  canvas.style.touchAction = 'none'

  addEventListener('keydown', (e) => {
    state.keys.add(e.code)
    if (!e.repeat) state.pressed.add(e.code)
  })
  addEventListener('keyup', (e) => state.keys.delete(e.code))
  addEventListener('blur', () => state.keys.clear())

  const toCanvas = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    state.pointer.x = ((e.clientX - r.left) / r.width) * canvas.width
    state.pointer.y = ((e.clientY - r.top) / r.height) * canvas.height
    return { x: state.pointer.x, y: state.pointer.y }
  }
  const release = (e: PointerEvent) => {
    state.pointers.delete(e.pointerId)
    state.pointer.down = state.pointers.size > 0
  }
  canvas.addEventListener('pointermove', (e) => {
    const p = toCanvas(e)
    if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, p)
  })
  canvas.addEventListener('pointerdown', (e) => {
    state.pointers.set(e.pointerId, toCanvas(e))
    state.pointer.down = true
    state.pressed.add('Pointer')
  })
  addEventListener('pointerup', release)
  addEventListener('pointercancel', release)

  // Plugin systems run before the game's, so the pads are fresh for every update system.
  let held = new Set<number>()
  game.system(() => {
    state.gamepads = navigator.getGamepads?.() ?? []
    const now = new Set<number>()
    for (const pad of state.gamepads) pad?.buttons.forEach((b, i) => b.pressed && now.add(i))
    for (const i of now) if (!held.has(i)) state.pressed.add(`Button${i}`)
    held = now
  })
  game.system(() => state.pressed.clear(), 'render')
  game.set(Input, state)
}
