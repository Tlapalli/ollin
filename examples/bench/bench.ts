// Shared setup for the Ollin vs Phaser benchmark: same canvas, sprite count and simulation on both pages.
export const WIDTH = 1280
export const HEIGHT = 720
export const SIZE = 32
export const GRAVITY = 1500
export const SPEED = 1000
export const COUNT = Number(new URLSearchParams(location.search).get('count') ?? 10_000)

// Time every requestAnimationFrame callback, so the result is the main-thread work per frame
// (simulation + engine + WebGL calls) regardless of which engine drives the loop.
const raf = requestAnimationFrame.bind(globalThis)
let work = 0
globalThis.requestAnimationFrame = (callback) =>
  raf((now) => {
    const start = performance.now()
    callback(now)
    work += performance.now() - start
  })

/** Samples per-frame work for `seconds` after a warmup and publishes `window.result` for the driver. */
export function measure(warmup = 1, seconds = 3) {
  const frames: number[] = []
  const start = performance.now()
  const tick = (now: number) => {
    if (now - start > warmup * 1000) frames.push(work)
    work = 0
    if (now - start < (warmup + seconds) * 1000) return raf(tick)
    const sorted = [...frames].sort((a, b) => a - b)
    const result = {
      count: COUNT,
      ms: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    }
    ;(globalThis as { result?: unknown }).result = result
    document.querySelector('#stats')!.textContent = `${result.count} sprites · ${result.ms} ms/frame · p95 ${result.p95} ms`
  }
  raf(tick)
}
