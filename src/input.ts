import { token, type Plugin } from './core'

export interface Input {
  /** Pressed keys by `KeyboardEvent.code` ('KeyA', 'Space', 'ArrowLeft'...). */
  keys: Set<string>
  pointer: { x: number; y: number; down: boolean }
}

export const Input = token<Input>('Input')

export const input = (): Plugin => (game) => {
  const state: Input = { keys: new Set(), pointer: { x: 0, y: 0, down: false } }
  const { canvas } = game

  addEventListener('keydown', (e) => state.keys.add(e.code))
  addEventListener('keyup', (e) => state.keys.delete(e.code))
  addEventListener('blur', () => state.keys.clear())
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    state.pointer.x = ((e.clientX - r.left) / r.width) * canvas.width
    state.pointer.y = ((e.clientY - r.top) / r.height) * canvas.height
  })
  canvas.addEventListener('pointerdown', () => (state.pointer.down = true))
  addEventListener('pointerup', () => (state.pointer.down = false))

  game.set(Input, state)
}
