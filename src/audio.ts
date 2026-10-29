import { token, type Plugin } from './core'

export interface PlayOptions {
  /** Gain multiplier, 1 = as recorded. */
  volume?: number
  loop?: boolean
  /** Playback rate; also shifts pitch. */
  rate?: number
}

export interface Audio {
  context: AudioContext
  /** Master volume, 0–1. */
  volume: number
  /** Loads and decodes sounds in parallel: `const s = await audio.load({ jump: jumpUrl })` gives a typed `s.jump`. */
  load<const M extends Record<string, string>>(manifest: M): Promise<{ [K in keyof M]: AudioBuffer }>
  /** Plays a sound and returns a function that stops it. */
  play(sound: AudioBuffer, options?: PlayOptions): () => void
}

export const Audio = token<Audio>('Audio')

export const audio = (): Plugin => (game) => {
  const context = new AudioContext()
  const master = context.createGain()
  master.connect(context.destination)

  // Browsers keep the context suspended until the first user gesture.
  const unlock = () => {
    if (context.state !== 'suspended') return
    void context.resume()
  }
  for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, unlock)

  game.set(Audio, {
    context,
    get volume() {
      return master.gain.value
    },
    set volume(value) {
      master.gain.value = value
    },
    async load(manifest) {
      const entries = Object.entries(manifest)
      const sounds = await Promise.all(
        entries.map(async ([, url]) => context.decodeAudioData(await (await fetch(url)).arrayBuffer())),
      )
      return Object.fromEntries(entries.map(([key], i) => [key, sounds[i]])) as never
    },
    play(sound, { volume = 1, loop = false, rate = 1 } = {}) {
      const source = context.createBufferSource()
      source.buffer = sound
      source.loop = loop
      source.playbackRate.value = rate
      const gain = context.createGain()
      gain.gain.value = volume
      source.connect(gain).connect(master)
      source.start()
      return () => source.stop()
    },
  })
}
