import { token, type Plugin } from './core'

/** Options for `audio.play`. */
export interface PlayOptions {
  /** Gain multiplier, 1 = as recorded. */
  volume?: number
  loop?: boolean
  /** Playback rate; also shifts pitch. */
  rate?: number
}

/** Web Audio playback: `game.get(Audio)` after adding the `audio()` plugin. */
export interface Audio {
  context: AudioContext
  /** Master volume, 0–1. */
  volume: number
  /** Loads and decodes sounds in parallel: `const s = await audio.load({ jump: jumpUrl })` gives a typed `s.jump`. Cached by URL. */
  load<const M extends Record<string, string>>(manifest: M): Promise<{ [K in keyof M]: AudioBuffer }>
  /** Plays a sound and returns a function that stops it. */
  play(sound: AudioBuffer, options?: PlayOptions): () => void
}

/** Resource key for the `Audio` registered by `audio()`. */
export const Audio = token<Audio>('Audio')

/** Plugin that sets up Web Audio and registers the `Audio` resource. Browsers start audio after the first input. */
export const audio = (): Plugin => (game) => {
  const context = new AudioContext()
  const master = context.createGain()
  master.connect(context.destination)
  const cache = new Map<string, Promise<AudioBuffer>>()
  const decode = (url: string) => {
    let sound = cache.get(url)
    if (!sound) cache.set(url, (sound = fetch(url).then((r) => r.arrayBuffer()).then((data) => context.decodeAudioData(data))))
    sound.catch(() => cache.delete(url)) // a failed load can be retried
    return sound
  }

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
      const sounds = await Promise.all(entries.map(([, url]) => decode(url)))
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
