import * as THREE from 'three'
import { collideMove, type AABB } from './map'
import type { SFX } from './audio'

export interface BotHooks {
  colliders: AABB[]
  bounds: AABB
  solids: THREE.Object3D[]
  playerEye: () => THREE.Vector3
  playerSpeedXZ: () => number
  tracer: (from: THREE.Vector3, to: THREE.Vector3, color: number) => void
  damagePlayer: (dmg: number, from: THREE.Vector3) => void
  sfx: SFX
}

export class Bot {
  group = new THREE.Group()
  hitboxes: THREE.Mesh[] = []
  hp = 100
  alive = true
  name = 'БОТ'

  private hooks: BotHooks
  private muzzle = new THREE.Object3D()
  private flash: THREE.Mesh
  private legL = new THREE.Object3D()
  private legR = new THREE.Object3D()
  private mats: THREE.MeshStandardMaterial[] = []
  private speed: number
  private strafeDir = Math.random() < 0.5 ? 1 : -1
  private strafeT = 1
  private burstLeft = 0
  private nextShot = 0
  private nextBurst = 0.8 + Math.random() * 1.2
  private blockedT = 0
  private lastX = 0
  private lastZ = 0
  private flashT = 0
  private deathT = 0
  private phase = Math.random() * 10
  private prefRange = 6.5 + Math.random() * 6.5
  private ray = new THREE.Raycaster()
  private tmpA = new THREE.Vector3()
  private tmpB = new THREE.Vector3()

  constructor(name: string, x: number, z: number, speed: number, hooks: BotHooks) {
    this.name = name
    this.speed = speed
    this.hooks = hooks
    this.group.position.set(x, 0, z)
    this.lastX = x
    this.lastZ = z

    const mat = (c: number) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })
      m.emissive = new THREE.Color(0xff2a00)
      m.emissiveIntensity = 0
      this.mats.push(m)
      return m
    }
    const mShirt = mat(0xc4722d)
    const mPants = mat(0x3a4149)
    const mSkin = mat(0xd9a06b)
    const mMask = mat(0x24272c)
    const mGun = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.5 })

    const box = (w: number, h: number, d: number, m: THREE.Material) =>
      new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)

    // legs (pivot at hip)
    const mkLeg = (sx: number, parent: THREE.Object3D) => {
      const mesh = box(0.17, 0.52, 0.2, mPants)
      mesh.position.y = -0.26
      mesh.castShadow = true
      mesh.userData = { bot: this, part: 'body' }
      parent.add(mesh)
      parent.position.set(sx, 0.52, 0)
      this.hitboxes.push(mesh)
    }
    mkLeg(-0.12, this.legL)
    mkLeg(0.12, this.legR)
    this.group.add(this.legL, this.legR)

    const torso = box(0.54, 0.62, 0.3, mShirt)
    torso.position.y = 0.85
    torso.castShadow = true
    torso.userData = { bot: this, part: 'body' }
    this.group.add(torso)
    this.hitboxes.push(torso)

    const vest = box(0.44, 0.34, 0.34, mMask)
    vest.position.y = 0.92
    vest.userData = { bot: this, part: 'body' }
    this.group.add(vest)
    this.hitboxes.push(vest)

    const head = box(0.25, 0.27, 0.25, mSkin)
    head.position.y = 1.33
    head.castShadow = true
    head.userData = { bot: this, part: 'head' }
    this.group.add(head)
    this.hitboxes.push(head)

    const hood = box(0.28, 0.17, 0.28, mMask)
    hood.position.y = 1.42
    hood.userData = { bot: this, part: 'head' }
    this.group.add(hood)
    this.hitboxes.push(hood)

    const armL = box(0.13, 0.46, 0.15, mShirt)
    armL.position.set(-0.34, 0.92, 0.05)
    armL.userData = { bot: this, part: 'body' }
    this.group.add(armL)
    this.hitboxes.push(armL)

    const armR = box(0.13, 0.42, 0.15, mShirt)
    armR.position.set(0.3, 0.95, 0.12)
    armR.rotation.x = -0.9
    armR.userData = { bot: this, part: 'body' }
    this.group.add(armR)
    this.hitboxes.push(armR)

    const gun = box(0.07, 0.1, 0.72, mGun)
    gun.position.set(0.22, 1.02, 0.36)
    gun.userData = { bot: this, part: 'body' }
    this.group.add(gun)
    this.hitboxes.push(gun)

    this.muzzle.position.set(0.22, 1.02, 0.78)
    this.group.add(this.muzzle)

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc36b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat)
    this.flash.position.copy(this.muzzle.position)
    this.flash.position.z += 0.1
    this.group.add(this.flash)
  }

  private hasLOS(target: THREE.Vector3): boolean {
    const from = this.tmpA.copy(this.group.position)
    from.y += 1.35
    const dir = this.tmpB.copy(target).sub(from)
    const d = dir.length()
    if (d < 0.001) return true
    this.ray.set(from, dir.normalize())
    this.ray.far = d - 0.5
    return this.ray.intersectObjects(this.hooks.solids, false).length === 0
  }

  fireAt(playerEye: THREE.Vector3, dist: number) {
    const muzzlePos = new THREE.Vector3()
    this.muzzle.getWorldPosition(muzzlePos)
    const pSpeed = this.hooks.playerSpeedXZ()
    const hitP = Math.max(0.06, Math.min(0.4, 0.36 - dist * 0.009 - pSpeed * 0.045))
    const willHit = Math.random() < hitP
    const to = playerEye.clone()
    if (!willHit) {
      to.x += (Math.random() - 0.5) * 1.6
      to.y += (Math.random() - 0.5) * 1.0
      to.z += (Math.random() - 0.5) * 1.6
    }
    this.hooks.tracer(muzzlePos, to, 0xffa24d)
    ;(this.flash.material as THREE.MeshBasicMaterial).opacity = 0.95
    this.flash.rotation.z = Math.random() * Math.PI
    this.flashT = 0.045
    this.hooks.sfx.enemyShoot(dist)
    if (willHit) this.hooks.damagePlayer(6 + Math.random() * 8, this.group.position)
  }

  hit(part: string, dmg: number): boolean {
    if (!this.alive) return false
    this.hp -= dmg
    this.flashT = Math.max(this.flashT, 0.02)
    for (const m of this.mats) m.emissiveIntensity = 0.9
    if (this.hp <= 0) {
      this.alive = false
      this.deathT = 0
      return true
    }
    return false
  }

  update(dt: number, playerPos: THREE.Vector3) {
    const p = this.group.position

    if (!this.alive) {
      this.deathT += dt
      this.group.rotation.x = -Math.min(1, this.deathT / 0.28) * (Math.PI / 2)
      if (this.deathT > 1.4) p.y -= dt * 1.1
      for (const m of this.mats) m.emissiveIntensity = Math.max(0, m.emissiveIntensity - dt * 4)
      return this.deathT < 2.6
    }

    const dx = playerPos.x - p.x
    const dz = playerPos.z - p.z
    const dist = Math.hypot(dx, dz) || 0.001
    this.group.lookAt(playerPos.x, p.y, playerPos.z)

    const eye = this.hooks.playerEye()
    const los = this.hasLOS(eye)

    this.strafeT -= dt
    if (this.strafeT <= 0) {
      this.strafeT = 0.7 + Math.random() * 1.5
      if (Math.random() < 0.75) this.strafeDir *= -1
    }

    let mx = 0
    let mz = 0
    if (!los || dist > this.prefRange) {
      mx = dx / dist
      mz = dz / dist
    } else {
      mx = (-dz / dist) * this.strafeDir
      mz = (dx / dist) * this.strafeDir
      if (dist < this.prefRange - 3) {
        mx -= (dx / dist) * 0.7
        mz -= (dz / dist) * 0.7
      }
    }
    const sp = this.speed * (los && dist <= this.prefRange ? 0.7 : 1)
    const prevX = p.x
    const prevZ = p.z
    collideMove(p, mx * sp * dt, mz * sp * dt, 0.38, this.hooks.colliders, this.hooks.bounds)
    const moved = Math.hypot(p.x - prevX, p.z - prevZ)
    if (moved < sp * dt * 0.25) {
      this.blockedT += dt
      if (this.blockedT > 0.45) {
        this.blockedT = 0
        this.strafeDir *= -1
        this.prefRange = 5.5 + Math.random() * 7.5
      }
    } else this.blockedT = 0
    void this.lastX; void this.lastZ
    this.lastX = p.x; this.lastZ = p.z

    this.phase += dt * (2 + sp)
    const swing = moved > 0.002 ? Math.sin(this.phase * 4.2) * 0.55 : 0
    this.legL.rotation.x = swing
    this.legR.rotation.x = -swing
    this.group.position.y = moved > 0.002 ? Math.abs(Math.sin(this.phase * 4.2)) * 0.045 : 0

    for (const m of this.mats) m.emissiveIntensity = Math.max(0, m.emissiveIntensity - dt * 5)
    if (this.flashT > 0) {
      this.flashT -= dt
      ;(this.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.flashT / 0.045)
    }
    this.flash.lookAt(eye)

    if (this.burstLeft > 0) {
      this.nextShot -= dt
      if (this.nextShot <= 0) {
        if (los && dist < 36) this.fireAt(eye, dist)
        this.burstLeft--
        this.nextShot = 0.13
        if (this.burstLeft === 0) this.nextBurst = Math.max(0.4, 1.1 + Math.random() * 1.2 - dist * 0.012)
      }
    } else {
      this.nextBurst -= dt
      if (this.nextBurst <= 0 && los && dist < 36) {
        this.burstLeft = 2 + ((Math.random() * 3) | 0)
        this.nextShot = 0.06
      }
    }
    return true
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group)
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
    for (const m of this.mats) m.dispose()
  }
}
