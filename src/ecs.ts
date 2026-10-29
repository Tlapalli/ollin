type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array

export type FieldType = new (length: number) => TypedArray
export type Schema = Record<string, FieldType>

export const f32 = Float32Array
export const f64 = Float64Array
export const i32 = Int32Array
export const u8 = Uint8Array
export const u16 = Uint16Array
export const u32 = Uint32Array

const META = Symbol('component')

interface Meta {
  readonly fields: readonly string[]
  readonly schema: Schema
  present: Uint8Array
}

/**
 * A component is plain SoA storage indexed by entity: `Position.x[e]`.
 * Arrays are replaced when the world grows (and when WASM memory grows), so read
 * `Position.x` inside each system run; never cache it across frames.
 */
export type Component<S extends Schema = Schema> = { [K in keyof S]: InstanceType<S[K]> } & {
  readonly [META]: Meta
}

export type Values<C> = C extends Component<infer S> ? Partial<Record<keyof S, number>> : never
export type Entity = number

// ponytail: component storage is global, so only one World is live at a time: a new World (game restart, HMR, tests)
// takes the components over with fresh storage. Scope storage per world if several worlds must coexist
export function defineComponent<const S extends Schema>(schema: S): Component<S> {
  const fields = Object.keys(schema)
  const component: Record<string | symbol, unknown> = {
    [META]: { fields, schema, present: new Uint8Array(0) } satisfies Meta,
  }
  for (const f of fields) component[f] = new schema[f](0)
  return component as Component<S>
}

const meta = (c: Component) => c[META]
const store = (c: Component) => c as unknown as Record<string, TypedArray>

function resize(c: Component, capacity: number, keep = true) {
  const m = meta(c)
  for (const f of m.fields) {
    const next = new m.schema[f](capacity)
    if (keep) next.set(store(c)[f])
    store(c)[f] = next
  }
  const present = new Uint8Array(capacity)
  if (keep) present.set(m.present)
  m.present = present
}

/** Live set of entities that have every listed component. Iterate `entities`; it stays dense. */
export class Query {
  readonly entities: Entity[] = []
  private readonly slot: number[] = []

  constructor(readonly components: readonly Component[]) {}

  matches(e: Entity) {
    return this.components.every((c) => meta(c).present[e] === 1)
  }

  insert(e: Entity) {
    if ((this.slot[e] ?? -1) >= 0) return
    this.slot[e] = this.entities.push(e) - 1
  }

  /** Swap-remove: iterate `entities` backwards if a system despawns while iterating. */
  delete(e: Entity) {
    const i = this.slot[e] ?? -1
    if (i < 0) return
    const last = this.entities.pop()!
    if (last !== e) {
      this.entities[i] = last
      this.slot[last] = i
    }
    this.slot[e] = -1
  }
}

// Always a tuple: a `C | [C, values]` union would let TS skip excess-key checks, so typos like `{ X: 1 }` would compile.
type Init<C> = readonly [C, NoInfer<Values<C>>?]

export class World {
  private capacity: number
  private next = 0
  // ponytail: ids are recycled without generations, so a stale Entity can point at a new one; add generations when entities are held across frames
  private readonly free: Entity[] = []
  private alive: Uint8Array
  private readonly components = new Set<Component>()
  private readonly queries = new Map<string, Query>()
  private readonly ids = new Map<Component, number>()

  constructor(capacity = 1024) {
    this.capacity = capacity
    this.alive = new Uint8Array(capacity)
  }

  get count() {
    return this.next - this.free.length
  }

  /** `world.spawn([Position, { x: 10, y: 20 }], [Tag])` */
  spawn<const T extends readonly Component[]>(...inits: { [K in keyof T]: Init<T[K]> }): Entity {
    const e = this.free.pop() ?? this.allocate()
    this.alive[e] = 1
    for (const [c, values] of inits as readonly Init<Component>[]) this.add(e, c, values)
    return e
  }

  despawn(e: Entity) {
    if (!this.alive[e]) return
    for (const c of this.components) if (meta(c).present[e]) this.remove(e, c)
    this.alive[e] = 0
    this.free.push(e)
  }

  /** Despawns every entity. Queries and component registrations stay, so plugins keep working. */
  clear() {
    for (let e = 0; e < this.next; e++) this.despawn(e)
  }

  /** Adds (or resets) a component. Fields not given in `values` are zeroed. */
  add<C extends Component>(e: Entity, c: C, values?: Values<C>) {
    this.register(c)
    const m = meta(c)
    for (const f of m.fields) store(c)[f][e] = (values as Record<string, number> | undefined)?.[f] ?? 0
    if (m.present[e]) return
    m.present[e] = 1
    for (const q of this.queries.values()) if (q.components.includes(c) && q.matches(e)) q.insert(e)
  }

  remove(e: Entity, c: Component) {
    if (!meta(c).present[e]) return
    meta(c).present[e] = 0
    for (const q of this.queries.values()) if (q.components.includes(c)) q.delete(e)
  }

  has(e: Entity, c: Component) {
    return meta(c).present[e] === 1
  }

  /** Cached: the same components always return the same Query, kept up to date on add/remove. */
  query(...components: Component[]): Query {
    for (const c of components) this.register(c)
    const key = components.map((c) => this.ids.get(c)).sort((a, b) => a! - b!).join(',')
    let q = this.queries.get(key)
    if (!q) {
      q = new Query(components)
      for (let e = 0; e < this.next; e++) if (this.alive[e] && q.matches(e)) q.insert(e)
      this.queries.set(key, q)
    }
    return q
  }

  private register(c: Component) {
    if (this.components.has(c)) return
    this.ids.set(c, this.ids.size)
    this.components.add(c)
    resize(c, this.capacity, false)
  }

  private allocate(): Entity {
    if (this.next === this.capacity) {
      this.capacity *= 2
      const alive = new Uint8Array(this.capacity)
      alive.set(this.alive)
      this.alive = alive
      for (const c of this.components) resize(c, this.capacity)
    }
    return this.next++
  }
}
