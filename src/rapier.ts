import RAPIER from '@dimforge/rapier2d-simd-compat'
import { Position, Rotation } from './components'
import { token, type Plugin } from './core'
import { defineComponent, f32, u8, type Entity } from './ecs'

export const BodyType = { Dynamic: 0, Fixed: 1 } as const
export const Shape = { Box: 0, Ball: 1 } as const

/**
 * Physics body for an entity with `Position` + `Collider`. The body is created on the next fixed step;
 * after that Rapier owns the transform and writes it back to `Position` (and `Rotation`, if present).
 * ponytail: dynamic and fixed bodies only; add kinematic bodies (ECS → Rapier sync) for moving platforms
 */
export const RigidBody = defineComponent({ type: u8, created: u8 })

/** Collider in pixels: `w`/`h` for boxes, `w` is the diameter for balls. Zero means Rapier's default. */
export const Collider = defineComponent({ shape: u8, w: f32, h: f32, density: f32, friction: f32, restitution: f32 })

export interface Physics {
  /** The Rapier module (`Ray`, `ColliderDesc`, ...), so games don't import their own copy. */
  rapier: typeof RAPIER
  /** The Rapier world, for raycasts, joints and anything the components don't cover. */
  world: RAPIER.World
  /** Rapier body of an entity, to apply impulses or read velocities. */
  body(e: Entity): RAPIER.RigidBody | undefined
  /** Pixels per meter. */
  scale: number
}

export const Physics = token<Physics>('Physics')

export interface RapierOptions {
  /** Gravity in m/s², positive is down (screen space). */
  gravity?: number
  /** Pixels per meter. Rapier is tuned for objects around 0.1–10 m. */
  scale?: number
}

export const rapier = ({ gravity = 9.81, scale = 50 }: RapierOptions = {}): Plugin =>
  async (game) => {
    await RAPIER.init()
    const physics = new RAPIER.World({ x: 0, y: gravity })
    physics.timestep = game.fixedDt
    const bodies = new Map<Entity, RAPIER.RigidBody>()
    const pending = game.world.query(Position, RigidBody, Collider)

    const create = (e: Entity) => {
      const desc = RigidBody.type[e] === BodyType.Fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()
      desc.setTranslation(Position.x[e] / scale, Position.y[e] / scale)
      if (game.world.has(e, Rotation)) desc.setRotation(Rotation.angle[e])
      const body = physics.createRigidBody(desc)

      const w = Collider.w[e] / scale
      const h = Collider.h[e] / scale
      const collider = Collider.shape[e] === Shape.Ball ? RAPIER.ColliderDesc.ball(w / 2) : RAPIER.ColliderDesc.cuboid(w / 2, h / 2)
      if (Collider.density[e]) collider.setDensity(Collider.density[e])
      if (Collider.friction[e]) collider.setFriction(Collider.friction[e])
      if (Collider.restitution[e]) collider.setRestitution(Collider.restitution[e])
      physics.createCollider(collider, body)

      RigidBody.created[e] = 1
      bodies.set(e, body)
    }

    const destroy = (e: Entity) => {
      physics.removeRigidBody(bodies.get(e)!)
      bodies.delete(e)
    }

    game.set(Physics, { rapier: RAPIER, world: physics, body: (e) => bodies.get(e), scale })

    game.system(() => {
      // Despawned entities (or a removed RigidBody) leave a body behind; a recycled id comes back with created = 0.
      for (const e of bodies.keys()) if (!game.world.has(e, RigidBody) || !RigidBody.created[e]) destroy(e)
      for (const e of pending.entities) if (!RigidBody.created[e]) create(e)

      physics.step()

      const { x, y } = Position
      const { angle } = Rotation
      for (const [e, body] of bodies) {
        if (!body.isDynamic() || body.isSleeping()) continue
        const t = body.translation()
        x[e] = t.x * scale
        y[e] = t.y * scale
        if (game.world.has(e, Rotation)) angle[e] = body.rotation()
      }
    }, 'fixed')
  }
