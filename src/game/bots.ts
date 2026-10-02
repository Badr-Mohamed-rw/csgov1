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

/* процедурный камуфляж для формы - улучшенный */
function camoTexture(base: string, spots: string[]): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256 // увеличено для детализации
  const g = cv.getContext('2d')!
  
  // Базовый цвет с градиентом
  const grad = g.createLinearGradient(0, 0, 256, 256)
  grad.addColorStop(0, base)
  grad.addColorStop(1, spots[0])
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  
  // Камуфляжные пятна разных размеров
  for (let i = 0; i < 80; i++) {
    g.fillStyle = spots[(Math.random() * spots.length) | 0]
    g.globalAlpha = 0.4 + Math.random() * 0.5
    g.beginPath()
    const size = 8 + Math.random() * 24
    g.ellipse(Math.random() * 256, Math.random() * 256, size, size * 0.7, Math.random() * Math.PI, 0, 7)
    g.fill()
  }
  
  // Мелкие детали - грязь и потёртости
  g.globalAlpha = 0.2
  for (let i = 0; i < 500; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#000000' : '#ffffff'
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
  
  // Вертикальные потёртости
  g.globalAlpha = 0.15
  for (let i = 0; i < 15; i++) {
    g.fillStyle = '#000000'
    const x = Math.random() * 256
    g.fillRect(x, 0, 2 + Math.random() * 4, 256)
  }
  
  g.globalAlpha = 1
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
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
  private armL = new THREE.Object3D()
  private armR = new THREE.Object3D()
  private headG = new THREE.Object3D()
  private torsoG = new THREE.Object3D()
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
  private prefRange = 9 + Math.random() * 9
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

    // Улучшенные камуфляжные текстуры для спецназа
    const camo = camoTexture('#4a5a3a', ['#3a4a2a', '#5a6a4a', '#2a3a1a', '#6a7a5a', '#4a5a3a'])
    const camoDark = camoTexture('#3a4a3a', ['#2a3a2a', '#4a5a4a', '#1a2a1a', '#3a4a3a'])
    
    const mat = (c: number, map?: THREE.Texture, rough = 0.85, metal = 0.05) => {
      const m = new THREE.MeshStandardMaterial({ 
        color: map ? 0xffffff : c, 
        map, 
        roughness: rough,
        metalness: metal
      })
      m.emissive = new THREE.Color(0xff2a00)
      m.emissiveIntensity = 0
      this.mats.push(m)
      return m
    }
    
    // Материалы для реалистичного спецназовца
    const mUniform = mat(0xffffff, camo, 0.85, 0.08)
    const mPants = mat(0xffffff, camoDark, 0.88, 0.06)
    const mSkin = mat(0xd4a574, undefined, 0.7, 0.02)
    const mVest = mat(0x2a3a2a, undefined, 0.8, 0.15) // Тактический жилет
    const mStrap = mat(0x1a2a1a, undefined, 0.75, 0.1)
    const mBoot = mat(0x1a1a1a, undefined, 0.82, 0.08)
    const mHelmet = mat(0x3a4a3a, undefined, 0.65, 0.2) // Шлем
    const mGlove = mat(0x2a2a2a, undefined, 0.85, 0.05)
    const mGun = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45, metalness: 0.7 })
    const mWood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.65, metalness: 0.05 })

    const box = (w: number, h: number, d: number, m: THREE.Material) =>
      new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    const cyl = (r1: number, r2: number, h: number, m: THREE.Material, seg = 12) =>
      new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m)
    const part = (mesh: THREE.Mesh, p: string, parent: THREE.Object3D, cast = true) => {
      mesh.castShadow = cast
      mesh.userData = { bot: this, part: p }
      parent.add(mesh)
      this.hitboxes.push(mesh)
      return mesh
    }

    /* ---- ноги (пивот в бедре) ---- */
    const mkLeg = (sx: number, pivot: THREE.Object3D) => {
      const thigh = box(0.17, 0.46, 0.2, mPants)
      thigh.position.y = -0.23
      part(thigh, 'legs', pivot)
      const shin = box(0.15, 0.42, 0.18, mPants)
      shin.position.y = -0.66
      part(shin, 'legs', pivot)
      const knee = box(0.17, 0.13, 0.12, mStrap)
      knee.position.set(0, -0.46, 0.08)
      part(knee, 'legs', pivot, false)
      const boot = box(0.17, 0.14, 0.3, mBoot)
      boot.position.set(0, -0.9, 0.045)
      part(boot, 'legs', pivot)
      pivot.position.set(sx, 0.96, 0)
      this.group.add(pivot)
    }
    mkLeg(-0.13, this.legL)
    mkLeg(0.13, this.legR)

    /* ---- торс ---- */
    const torso = box(0.52, 0.58, 0.28, mUniform)
    torso.position.y = 1.26
    part(torso, 'body', this.group)

    const vest = box(0.46, 0.36, 0.34, mVest)
    vest.position.y = 1.3
    part(vest, 'body', this.group, false)
    // подсумки
    for (let i = -1; i <= 1; i++) {
      const pouch = box(0.1, 0.12, 0.06, mStrap)
      pouch.position.set(i * 0.13, 1.24, 0.2)
      part(pouch, 'body', this.group, false)
    }
    // плечевые лямки
    const strapL = box(0.08, 0.4, 0.36, mStrap)
    strapL.position.set(-0.14, 1.34, 0)
    part(strapL, 'body', this.group, false)
    const strapR = box(0.08, 0.4, 0.36, mStrap)
    strapR.position.set(0.14, 1.34, 0)
    part(strapR, 'body', this.group, false)

    // рюкзак
    const pack = box(0.4, 0.42, 0.16, mVest)
    pack.position.set(0, 1.28, -0.24)
    part(pack, 'body', this.group)
    const roll = cyl(0.07, 0.07, 0.38, mStrap)
    roll.rotation.z = Math.PI / 2
    roll.position.set(0, 1.52, -0.26)
    part(roll, 'body', this.group, false)

    /* ---- голова ---- */
    this.headG.position.y = 1.62
    this.group.add(this.headG)
    const neck = cyl(0.06, 0.07, 0.08, mSkin)
    neck.position.y = -0.06
    part(neck, 'head', this.headG, false)
    const head = box(0.23, 0.26, 0.24, mSkin)
    head.position.y = 0.06
    part(head, 'head', this.headG)
    const mask = box(0.2, 0.09, 0.05, mStrap)
    mask.position.set(0, -0.02, 0.12)
    part(mask, 'head', this.headG, false)
    const helmet = cyl(0.17, 0.145, 0.16, mHelmet, 14)
    helmet.position.y = 0.2
    part(helmet, 'head', this.headG)
    const brim = cyl(0.185, 0.185, 0.03, mHelmet, 14)
    brim.position.y = 0.125
    part(brim, 'head', this.headG, false)
    const goggle = box(0.2, 0.06, 0.03, mStrap)
    goggle.position.set(0, 0.1, 0.13)
    part(goggle, 'head', this.headG, false)

    /* ---- руки (пивот в плече), держат автомат ---- */
    const mkArm = (sx: number, pivot: THREE.Object3D, bend: number, reachZ: number) => {
      const upper = box(0.13, 0.34, 0.14, mUniform)
      upper.position.y = -0.15
      part(upper, 'arms', pivot)
      const fore = box(0.11, 0.3, 0.12, mUniform)
      fore.position.set(0, -0.32, reachZ)
      fore.rotation.x = bend
      part(fore, 'arms', pivot)
      const glove = box(0.11, 0.1, 0.13, mGlove)
      glove.position.set(0, -0.42, reachZ + Math.sin(bend) * 0.16)
      glove.rotation.x = bend
      part(glove, 'arms', pivot, false)
      pivot.position.set(sx, 1.5, 0)
      this.group.add(pivot)
    }
    mkArm(-0.33, this.armL, -1.15, 0.22)   // левая — у цевья
    mkArm(0.33, this.armR, -0.75, 0.1)     // правая — у рукояти

    /* ---- автомат в руках ---- */
    const gunG = new THREE.Group()
    gunG.position.set(0.14, 1.16, 0.3)
    this.group.add(gunG)
    const body = box(0.07, 0.1, 0.5, mGun)
    part(body, 'body', gunG, false)
    const barrel = cyl(0.018, 0.018, 0.34, mGun)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.02, 0.4)          // ствол в сторону игрока (+Z)
    part(barrel, 'body', gunG, false)
    const guard = box(0.06, 0.07, 0.2, mWood)
    guard.position.set(0, -0.005, 0.22)
    part(guard, 'body', gunG, false)
    const mag = box(0.055, 0.18, 0.09, mGun)
    mag.position.set(0, -0.13, -0.02)
    mag.rotation.x = -0.22
    part(mag, 'body', gunG, false)
    const stock = box(0.06, 0.09, 0.2, mWood)
    stock.position.set(0, -0.01, -0.34)
    part(stock, 'body', gunG, false)

    this.muzzle.position.set(0.14, 1.19, 0.68)
    this.group.add(this.muzzle)

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc36b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), flashMat)
    this.flash.position.copy(this.muzzle.position)
    this.flash.position.z += 0.12
    this.group.add(this.flash)
  }

  private hasLOS(target: THREE.Vector3): boolean {
    const from = this.tmpA.copy(this.group.position)
    from.y += 1.5
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

  hit(partName: string, dmg: number): boolean {
    if (!this.alive) return false
    const mult = partName === 'legs' ? 0.75 : partName === 'arms' ? 0.85 : 1
    this.hp -= dmg * mult
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

    /* анимация: ноги, руки, покачивание, дыхание */
    const walking = moved > 0.002
    this.phase += dt * (2 + sp)
    const swing = walking ? Math.sin(this.phase * 4.2) * 0.62 : 0
    this.legL.rotation.x = swing
    this.legR.rotation.x = -swing
    this.armL.rotation.x = walking ? Math.sin(this.phase * 4.2) * 0.1 : 0
    this.armR.rotation.x = walking ? -Math.sin(this.phase * 4.2) * 0.08 : 0
    const bob = walking ? Math.abs(Math.sin(this.phase * 4.2)) * 0.05 : Math.sin(this.time2(dt)) * 0.012
    this.group.position.y = bob
    this.headG.rotation.y = Math.sin(this.phase * 0.7) * 0.06

    for (const m of this.mats) m.emissiveIntensity = Math.max(0, m.emissiveIntensity - dt * 5)
    if (this.flashT > 0) {
      this.flashT -= dt
      ;(this.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.flashT / 0.045)
    }
    this.flash.lookAt(eye)

    if (this.burstLeft > 0) {
      this.nextShot -= dt
      if (this.nextShot <= 0) {
        if (los && dist < 52) this.fireAt(eye, dist)
        this.burstLeft--
        this.nextShot = 0.13
        if (this.burstLeft === 0) this.nextBurst = Math.max(0.4, 1.1 + Math.random() * 1.2 - dist * 0.012)
      }
    } else {
      this.nextBurst -= dt
      if (this.nextBurst <= 0 && los && dist < 52) {
        this.burstLeft = 2 + ((Math.random() * 3) | 0)
        this.nextShot = 0.06
      }
    }
    return true
  }

  private idleT = 0
  private time2(dt: number) {
    this.idleT += dt
    return this.idleT * 2
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
