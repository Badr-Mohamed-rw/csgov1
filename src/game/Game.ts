import * as THREE from 'three'
import { buildMap, collideMove, type MapData } from './map'
import { Bot, type BotHooks } from './bots'
import { SFX } from './audio'

export interface HudData {
  hp: number; armor: number; mag: number; res: number; nades: number
  timer: number; spreadPx: number; enemies: number; reloading: boolean
}
export interface FeedEntry { id: number; killer: string; victim: string; head: boolean; byPlayer: boolean }
export interface BannerData { title: string; sub?: string; tone: 'win' | 'lose' | 'info' }
export interface OverData { result: 'victory' | 'defeat'; kills: number; deaths: number; won: number; lost: number }
export interface RadarData { px: number; pz: number; yaw: number; dots: { x: number; z: number }[] }

export interface GameHooks {
  hud(h: HudData): void
  score(a: number, b: number): void
  kills(k: number): void
  hitmark(kind: 'hit' | 'head' | 'kill'): void
  damage(amount: number, relAngle: number): void
  feed(e: Omit<FeedEntry, 'id'>): void
  banner(b: BannerData): void
  radar(d: RadarData): void
  over(o: OverData): void
  lockedChange(locked: boolean): void
}

type State = 'attract' | 'playing' | 'roundEnd' | 'dying' | 'paused'

const NAMES = ['Феникс', 'Гюрза', 'Кобра', 'Шакал', 'Коршун', 'Таран', 'Волк', 'Гадюка', 'Беркут', 'Росомаха']
const ROUND_TIME = 100
const WINS_NEEDED = 3
const MAG_SIZE = 30

interface Particle { m: THREE.Mesh; v: THREE.Vector3; g: number; life: number; max: number }
interface Tracer { m: THREE.Mesh; life: number }
interface Nade { m: THREE.Mesh; v: THREE.Vector3; fuse: number }

export class Game {
  state: State = 'attract'

  private container: HTMLElement
  private hooks: GameHooks
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private raf = 0
  private time = 0
  private attractT = 0
  private sfx = new SFX()
  private map: MapData

  // player
  private pos = new THREE.Vector3()
  private vel = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private recoilPitch = 0
  private recoilYaw = 0
  private kick = 0
  private spread = 0
  private shake = 0
  private bobT = 0
  private stepAcc = 0
  private onGround = true
  private locked = false
  private hp = 100
  private armor = 100
  private mag = MAG_SIZE
  private res = 90
  private nades = 1
  private reloading = false
  private reloadT = 0
  private cooldown = 0
  private firing = false
  private lastCX = 0
  private lastCY = 0
  private mouseInit = false
  private keys: Record<string, boolean> = {}
  private deathT = 0

  // match
  private round = 0
  private scoreA = 0
  private scoreB = 0
  private kills = 0
  private deaths = 0
  private roundT = ROUND_TIME

  // entities
  private bots: Bot[] = []
  private nadesFly: Nade[] = []
  private particles: Particle[] = []
  private tracers: Tracer[] = []

  // fx objects
  private weapon = new THREE.Group()
  private muzzle = new THREE.Object3D()
  private flash: THREE.Mesh
  private flashT = 0
  private gunLight: THREE.PointLight
  private boomLight: THREE.PointLight
  private boomT = 0

  private ray = new THREE.Raycaster()
  private tmpV = new THREE.Vector3()
  private tmpD = new THREE.Vector3()
  private roundTimeout = 0

  constructor(container: HTMLElement, hooks: GameHooks) {
    this.container = container
    this.hooks = hooks

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x93a9bc)
    this.scene.fog = new THREE.Fog(0xaeb9bd, 34, 95)

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 220)
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera)

    const hemi = new THREE.HemisphereLight(0xcfe2f5, 0x9b8a63, 1.1)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffeccc, 2.6)
    sun.position.set(-26, 38, -18)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -34
    sun.shadow.camera.right = 34
    sun.shadow.camera.top = 34
    sun.shadow.camera.bottom = -34
    sun.shadow.camera.far = 100
    sun.shadow.bias = -0.0006
    this.scene.add(sun)
    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.4))

    this.map = buildMap(this.scene)

    // weapon lights
    this.gunLight = new THREE.PointLight(0xffc36b, 0, 9, 2)
    this.gunLight.position.set(0.3, -0.15, -0.7)
    this.camera.add(this.gunLight)
    this.boomLight = new THREE.PointLight(0xff9040, 0, 22, 2)
    this.scene.add(this.boomLight)

    this.buildWeapon()
    this.flash = this.buildFlash(0.55)
    this.muzzle.add(this.flash)

    // pools
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      )
      m.visible = false
      this.scene.add(m)
      this.tracers.push({ m, life: 0 })
    }

    this.pos.set(this.map.playerSpawn.x, 0, this.map.playerSpawn.z)
    this.bindEvents()
    this.loop()
  }

  /* ================= weapon ================= */

  private buildWeapon() {
    const w = this.weapon
    const metal = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.5, metalness: 0.65 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x7c4a24, roughness: 0.75, metalness: 0.1 })
    const box = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m)
      mesh.position.set(x, y, z)
      mesh.rotation.x = rx
      w.add(mesh)
      return mesh
    }
    box(0.075, 0.095, 0.5, metal, 0, 0, -0.04)                    // receiver
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 10), metal)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.022, -0.46)
    w.add(barrel)
    box(0.068, 0.072, 0.24, wood, 0, -0.004, -0.28)               // handguard
    box(0.03, 0.03, 0.3, metal, 0, 0.062, -0.32)                  // gas tube
    box(0.058, 0.2, 0.1, metal, 0, -0.16, 0.03, 0.22)             // magazine
    box(0.06, 0.085, 0.24, wood, 0, -0.012, 0.3)                  // stock
    box(0.012, 0.05, 0.012, metal, 0, 0.078, -0.6)                // front sight
    box(0.05, 0.03, 0.02, metal, 0, 0.062, 0.1)                   // rear sight
    this.muzzle.position.set(0, 0.022, -0.66)
    w.add(this.muzzle)
    w.position.set(0.24, -0.22, -0.45)
    this.camera.add(w)
  }

  private buildFlash(size: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc97a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    const g = new THREE.Group()
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat)
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.36), mat)
    p2.rotation.z = Math.PI / 2
    g.add(p1, p2)
    const holder = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), mat)
    holder.add(g)
    return holder
  }

  /* ================= events ================= */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space') e.preventDefault()
    this.keys[e.code] = true
    if (this.state !== 'playing') return
    if (e.code === 'Escape' && !this.locked) { this.pause(); return }
    if (e.code === 'KeyR') this.startReload()
    if (e.code === 'KeyG') this.throwNade()
  }
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false }

  private onMouseMove = (e: MouseEvent) => {
    if (this.state !== 'playing') return
    if (this.locked) {
      // захват мыши: движение 1:1
      const s = 0.0032
      this.yaw -= e.movementX * s
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * s))
    } else {
      // без захвата: камера следует за движением мыши (по дельте)
      if (!this.mouseInit) {
        this.lastCX = e.clientX
        this.lastCY = e.clientY
        this.mouseInit = true
        return
      }
      const dx = e.movementX ?? e.clientX - this.lastCX
      const dy = e.movementY ?? e.clientY - this.lastCY
      this.lastCX = e.clientX
      this.lastCY = e.clientY
      const s = 0.0045
      this.yaw -= dx * s
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * s))
    }
  }
  private onMouseDown = (e: MouseEvent) => {
    this.sfx.ensure()
    if (this.state !== 'playing') return
    // ЛКМ — всегда огонь
    if (e.button === 0) {
      this.firing = true
      this.tryShoot()
      if (!this.locked) this.requestLock()
    } else if (e.button === 2) {
      this.firing = true
      this.tryShoot()
    }
  }
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 2) this.firing = false
  }

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.renderer.domElement
    if (this.locked && !locked && this.state === 'playing') this.pause()
    this.mouseInit = false
    this.locked = locked
    this.hooks.lockedChange(locked)
  }
  private onResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }
  private onVisibility = () => {
    if (document.hidden && this.state === 'playing') this.pause()
  }
  private onContext = (e: Event) => e.preventDefault()

  private bindEvents() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('resize', this.onResize)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.renderer.domElement.addEventListener('contextmenu', this.onContext)
  }

  private requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch { /* ignore */ }
  }

  /* ================= public control ================= */

  startMatch() {
    this.sfx.ensure()
    this.scoreA = 0
    this.scoreB = 0
    this.round = 0
    this.kills = 0
    this.deaths = 0
    this.hooks.score(0, 0)
    this.hooks.kills(0)
    this.startRound()
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = 'playing'
    this.requestLock()
  }

  pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.firing = false
    this.mouseInit = false
    if (document.pointerLockElement) document.exitPointerLock()
    else this.hooks.lockedChange(false)
  }

  toMenu() {
    window.clearTimeout(this.roundTimeout)
    this.clearEntities()
    this.state = 'attract'
    if (document.pointerLockElement) document.exitPointerLock()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContext)
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) this.container.removeChild(this.renderer.domElement)
  }

  /* ================= rounds ================= */

  private clearEntities() {
    for (const b of this.bots) b.dispose(this.scene)
    this.bots = []
    for (const n of this.nadesFly) this.scene.remove(n.m)
    this.nadesFly = []
    for (const p of this.particles) { p.life = 0; p.m.visible = false }
  }

  private startRound() {
    this.round++
    this.clearEntities()
    const sp = this.map.playerSpawn
    this.pos.set(sp.x, 0, sp.z)
    this.vel.set(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
    this.recoilPitch = 0
    this.recoilYaw = 0
    this.spread = 0
    this.shake = 0
    this.kick = 0
    this.hp = 100
    this.armor = 100
    this.mag = MAG_SIZE
    this.res = 90
    this.nades = Math.min(3, this.round)
    this.reloading = false
    this.firing = false
    this.roundT = ROUND_TIME

    const count = Math.min(8, 2 + this.round)
    const spawns = [...this.map.botSpawns].sort(() => Math.random() - 0.5)
    const botHooks: BotHooks = {
      colliders: this.map.colliders,
      bounds: this.map.bounds,
      solids: this.map.solids,
      playerEye: () => this.tmpV.set(this.pos.x, this.pos.y + 1.55, this.pos.z),
      playerSpeedXZ: () => Math.hypot(this.vel.x, this.vel.z),
      tracer: (a, b, c) => this.spawnTracer(a, b, c),
      damagePlayer: (d, from) => this.damagePlayer(d, from),
      sfx: this.sfx,
    }
    for (let i = 0; i < count; i++) {
      const s = spawns[i % spawns.length]
      const bot = new Bot(NAMES[i % NAMES.length], s.x + (Math.random() - 0.5), s.z + (Math.random() - 0.5), 3 + this.round * 0.22 + Math.random() * 0.3, botHooks)
      bot.group.rotation.y = Math.random() * Math.PI * 2
      this.scene.add(bot.group)
      bot.group.updateMatrixWorld(true)
      this.bots.push(bot)
    }

    this.state = 'playing'
    const need = WINS_NEEDED - this.scoreA
    this.hooks.banner({
      title: `РАУНД ${this.round}`,
      sub: `противников: ${count} · до победы: ${need}`,
      tone: 'info',
    })
    this.sfx.beep(760, 0.12, 0.22)
    this.requestLock()
  }

  private endRound(won: boolean) {
    if (this.state !== 'playing' && this.state !== 'dying') return
    this.state = 'roundEnd'
    this.firing = false
    if (won) this.scoreA++
    else this.scoreB++
    this.hooks.score(this.scoreA, this.scoreB)
    if (document.pointerLockElement) document.exitPointerLock()
    const done = this.scoreA >= WINS_NEEDED || this.scoreB >= WINS_NEEDED
    this.hooks.banner({
      title: won ? 'РАУНД ВЫИГРАН' : 'РАУНД ПРОИГРАН',
      sub: `счёт ${this.scoreA} : ${this.scoreB}`,
      tone: won ? 'win' : 'lose',
    })
    if (won) this.sfx.win()
    else this.sfx.lose()
    this.roundTimeout = window.setTimeout(() => {
      if (done) this.finish(this.scoreA > this.scoreB)
      else this.startRound()
    }, 3100)
  }

  private finish(victory: boolean) {
    this.hooks.over({
      result: victory ? 'victory' : 'defeat',
      kills: this.kills,
      deaths: this.deaths,
      won: this.scoreA,
      lost: this.scoreB,
    })
    this.clearEntities()
    this.state = 'attract'
  }

  /* ================= combat ================= */

  private startReload() {
    if (this.reloading || this.mag >= MAG_SIZE || this.state !== 'playing') return
    if (this.res <= 0) {
      this.res = 30
      this.hooks.feed({ killer: 'Снабжение', victim: '+30 патронов', head: false, byPlayer: true })
    }
    this.reloading = true
    this.reloadT = 1.9
    this.sfx.reload()
  }

  private tryShoot() {
    if (this.state !== 'playing' || this.cooldown > 0 || this.reloading) return
    if (this.mag <= 0) {
      this.sfx.dry()
      this.firing = false
      this.startReload()
      return
    }
    this.mag--
    this.cooldown = 0.096
    this.sfx.shoot()

    // fx
    this.flashT = 0.04
    this.flash.rotation.z = Math.random() * Math.PI
    const fs = 0.75 + Math.random() * 0.5
    this.flash.scale.set(fs, fs, fs)
    this.gunLight.intensity = 26
    this.kick = Math.min(1.6, this.kick + 1)
    this.recoilPitch += 0.013 + Math.random() * 0.008
    this.recoilYaw += (Math.random() - 0.5) * 0.01
    this.spread = Math.min(1, this.spread + (this.onGround ? 0.16 : 0.26))

    // hitscan
    this.camera.getWorldDirection(this.tmpD)
    const spreadRad = 0.0035 + this.spread * 0.02
    this.tmpD.x += (Math.random() - 0.5) * 2 * spreadRad
    this.tmpD.y += (Math.random() - 0.5) * 2 * spreadRad
    this.tmpD.z += (Math.random() - 0.5) * 2 * spreadRad
    this.tmpD.normalize()
    this.camera.getWorldPosition(this.tmpV)
    this.ray.set(this.tmpV, this.tmpD)
    this.ray.far = 140

    const targets: THREE.Object3D[] = [...this.map.solids]
    for (const b of this.bots) if (b.alive) targets.push(...b.hitboxes)
    const hits = this.ray.intersectObjects(targets, false)

    const muzzlePos = new THREE.Vector3()
    this.muzzle.getWorldPosition(muzzlePos)
    const end = hits.length ? hits[0].point : this.tmpV.clone().addScaledVector(this.tmpD, 120)
    this.spawnTracer(muzzlePos, end, 0xffd27a)

    if (hits.length) {
      const ud = hits[0].object.userData as { bot?: Bot; part?: string }
      if (ud.bot && ud.bot.alive) {
        const head = ud.part === 'head'
        const killed = ud.bot.hit(ud.part || 'body', head ? 100 : 26)
        this.burst(hits[0].point, 0x9e1b1b, head ? 16 : 10, 3.4, 0.5)
        if (killed) {
          this.onBotKilled(ud.bot, head)
        } else {
          this.hooks.hitmark(head ? 'head' : 'hit')
          this.sfx.hit(head)
        }
      } else {
        this.burst(hits[0].point, 0xd8c08a, 7, 2.6, 0.35)
        this.burst(hits[0].point, 0xfff0b8, 4, 3.4, 0.25)
      }
    }
  }

  private onBotKilled(bot: Bot, head: boolean) {
    this.kills++
    this.res = Math.min(120, this.res + 30)
    this.hooks.kills(this.kills)
    this.hooks.hitmark('kill')
    this.hooks.feed({ killer: 'ВЫ', victim: bot.name, head, byPlayer: true })
    this.sfx.kill()
    const p = bot.group.position
    this.burst(new THREE.Vector3(p.x, p.y + 1, p.z), 0x9e1b1b, 18, 4.2, 0.7)
  }

  private damagePlayer(dmg: number, from: THREE.Vector3) {
    if (this.state !== 'playing') return
    let d = dmg
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, d * 0.5)
      this.armor -= absorbed
      d -= absorbed
    }
    this.hp -= d
    this.shake = Math.min(1.2, this.shake + d / 22)
    const dx = from.x - this.pos.x
    const dz = from.z - this.pos.z
    const rel = this.normAngle(this.yaw + Math.PI - Math.atan2(dx, dz))
    this.hooks.damage(d, rel)
    this.sfx.hurt()
    if (this.hp <= 0) {
      this.hp = 0
      this.deaths++
      const kb = this.bots.find((b) => b.group.position === from)
      this.hooks.feed({ killer: kb ? kb.name : 'Взрыв', victim: 'ВЫ', head: false, byPlayer: false })
      this.state = 'dying'
      this.deathT = 0
      this.firing = false
      this.hooks.banner({ title: 'ВЫ УБИТЫ', sub: 'раунд потерян', tone: 'lose' })
      this.sfx.lose()
    }
  }

  private normAngle(a: number) {
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return a
  }

  /* ================= grenade ================= */

  private throwNade() {
    if (this.nades <= 0 || this.state !== 'playing') return
    this.nades--
    this.sfx.pin()
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.6 })
    )
    m.castShadow = true
    this.camera.getWorldPosition(this.tmpV)
    this.camera.getWorldDirection(this.tmpD)
    m.position.copy(this.tmpV).addScaledVector(this.tmpD, 0.5)
    const v = this.tmpD.clone().multiplyScalar(13.5)
    v.y += 3.4
    v.x += this.vel.x * 0.35
    v.z += this.vel.z * 0.35
    this.scene.add(m)
    this.nadesFly.push({ m, v, fuse: 1.45 })
  }

  private updateNades(dt: number) {
    for (let i = this.nadesFly.length - 1; i >= 0; i--) {
      const n = this.nadesFly[i]
      n.v.y -= 21 * dt
      n.m.position.addScaledVector(n.v, dt)
      const p = n.m.position
      if (p.y < 0.09) {
        p.y = 0.09
        n.v.y = Math.abs(n.v.y) * 0.42
        n.v.x *= 0.72
        n.v.z *= 0.72
      }
      // simple AABB bounce
      for (const c of this.map.colliders) {
        if (p.x > c.minX - 0.09 && p.x < c.maxX + 0.09 && p.z > c.minZ - 0.09 && p.z < c.maxZ + 0.09 && p.y < 3) {
          const dxL = p.x - (c.minX - 0.09)
          const dxR = (c.maxX + 0.09) - p.x
          const dzN = p.z - (c.minZ - 0.09)
          const dzF = (c.maxZ + 0.09) - p.z
          const m = Math.min(dxL, dxR, dzN, dzF)
          if (m === dxL) { p.x = c.minX - 0.09; n.v.x = -Math.abs(n.v.x) * 0.5 }
          else if (m === dxR) { p.x = c.maxX + 0.09; n.v.x = Math.abs(n.v.x) * 0.5 }
          else if (m === dzN) { p.z = c.minZ - 0.09; n.v.z = -Math.abs(n.v.z) * 0.5 }
          else { p.z = c.maxZ + 0.09; n.v.z = Math.abs(n.v.z) * 0.5 }
        }
      }
      n.fuse -= dt
      const s = n.fuse < 0.5 ? 1 + Math.sin(this.time * 30) * 0.15 : 1
      n.m.scale.set(s, s, s)
      if (n.fuse <= 0) {
        this.explode(p.clone())
        this.scene.remove(n.m)
        this.nadesFly.splice(i, 1)
      }
    }
  }

  private explode(at: THREE.Vector3) {
    this.sfx.boom()
    this.boomLight.position.copy(at)
    this.boomLight.intensity = 260
    this.boomT = 0.3
    this.shake = Math.min(1.4, this.shake + 0.9)
    this.burst(at, 0xff9040, 26, 9, 0.7, 5)
    this.burst(at, 0xffe0a0, 18, 12, 0.4, 6)
    this.burst(at, 0x55504a, 20, 5, 1.1, 2)
    for (const b of this.bots) {
      if (!b.alive) continue
      const d = b.group.position.distanceTo(at)
      if (d < 6.5) {
        const killed = b.hit('body', 130 * (1 - d / 6.5))
        if (killed) this.onBotKilled(b, false)
      }
    }
    const pd = Math.hypot(this.pos.x - at.x, this.pos.z - at.z)
    if (pd < 5.5) this.damagePlayer(50 * (1 - pd / 5.5), at)
  }

  /* ================= particles / tracers ================= */

  private burst(at: THREE.Vector3, color: number, count: number, speed: number, life: number, gravity = 9) {
    for (let i = 0; i < count; i++) {
      let p = this.particles.find((q) => q.life <= 0)
      if (!p) {
        if (this.particles.length > 280) return
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.06, 0.06),
          new THREE.MeshBasicMaterial({ color, transparent: true })
        )
        this.scene.add(m)
        p = { m, v: new THREE.Vector3(), g: gravity, life: 0, max: 1 }
        this.particles.push(p)
      }
      ;(p.m.material as THREE.MeshBasicMaterial).color.set(color)
      p.m.visible = true
      p.m.position.copy(at)
      p.v.set((Math.random() - 0.5) * 2, Math.random() * 1.4, (Math.random() - 0.5) * 2).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8))
      p.g = gravity
      p.max = life * (0.6 + Math.random() * 0.7)
      p.life = p.max
      const sc = 0.6 + Math.random()
      p.m.scale.set(sc, sc, sc)
    }
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const t = this.tracers.find((q) => q.life <= 0)
    if (!t) return
    const mid = from.clone().add(to).multiplyScalar(0.5)
    const len = from.distanceTo(to)
    t.m.position.copy(mid)
    t.m.scale.set(0.022, 0.022, Math.max(0.1, len))
    t.m.lookAt(to)
    const mat = t.m.material as THREE.MeshBasicMaterial
    mat.color.set(color)
    mat.opacity = 0.85
    t.m.visible = true
    t.life = 0.07
  }

  private updateFx(dt: number) {
    // particles
    for (const p of this.particles) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) { p.m.visible = false; continue }
      p.v.y -= p.g * dt
      p.m.position.addScaledVector(p.v, dt)
      if (p.m.position.y < 0.02) { p.m.position.y = 0.02; p.v.y = Math.abs(p.v.y) * 0.3; p.v.x *= 0.7; p.v.z *= 0.7 }
      ;(p.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life / p.max * 1.4)
    }
    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue
      t.life -= dt
      if (t.life <= 0) { t.m.visible = false; continue }
      ;(t.m.material as THREE.MeshBasicMaterial).opacity = (t.life / 0.07) * 0.85
    }
    // muzzle flash + lights
    if (this.flashT > 0) {
      this.flashT -= dt
      this.setFlashOpacity(Math.max(0, this.flashT / 0.04))
    } else {
      this.setFlashOpacity(0)
    }
    this.gunLight.intensity = Math.max(0, this.gunLight.intensity - dt * 260)
    if (this.boomT > 0) {
      this.boomT -= dt
      this.boomLight.intensity = Math.max(0, this.boomT / 0.3) * 260
    }
    // recoil / shake decay
    this.recoilPitch *= Math.exp(-9 * dt)
    this.recoilYaw *= Math.exp(-9 * dt)
    this.kick = Math.max(0, this.kick - dt * 9)
    this.shake = Math.max(0, this.shake - dt * 2.6)
  }

  private setFlashOpacity(o: number) {
    this.flash.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (mesh.material) (mesh.material as THREE.MeshBasicMaterial).opacity = o
    })
  }

  /* ================= main loop ================= */

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, this.clock.getDelta())
    this.time += dt

    const dust = this.scene.getObjectByName('dust')
    if (dust) dust.rotation.y += dt * 0.012

    if (this.state === 'attract') {
      this.attractT += dt * 0.09
      const r = 17
      this.camera.position.set(Math.sin(this.attractT) * r, 7.5 + Math.sin(this.attractT * 0.6) * 2, Math.cos(this.attractT) * r)
      this.camera.lookAt(0, 1.2, 0)
      this.weapon.visible = false
    } else {
      this.weapon.visible = true
      if (this.state === 'playing') this.updatePlaying(dt)
      else if (this.state === 'dying') this.updateDying(dt)
      this.updateFx(dt)
      if (this.state !== 'playing') this.updateNades(dt)
    }

    // скрываем системный курсор на время боя
    const el = this.renderer.domElement
    const wantCursor = this.state === 'playing' || this.state === 'dying' ? 'none' : ''
    if (el.dataset.cur !== wantCursor) {
      el.dataset.cur = wantCursor
      el.style.cursor = wantCursor
    }

    this.renderer.render(this.scene, this.camera)
  }

  private updateDying(dt: number) {
    this.deathT += dt
    this.camera.position.set(this.pos.x, Math.max(0.45, this.pos.y + 1.55 - this.deathT * 1.4), this.pos.z)
    this.camera.rotation.set(this.pitch * 0.4 - this.deathT * 0.25, this.yaw, Math.min(1.15, this.deathT * 1.6))
    if (this.deathT > 1.9) this.endRound(false)
  }

  private updatePlaying(dt: number) {
    // ---- movement ----
    const f = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0)
    const s = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0)
    const walk = !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight']
    const speed = walk ? 2.6 : 5.7
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let wx = -sin * f + cos * s
    let wz = -cos * f - sin * s
    const wl = Math.hypot(wx, wz)
    if (wl > 0.01) { wx = (wx / wl) * speed; wz = (wz / wl) * speed }
    else { wx = 0; wz = 0 }
    const k = this.onGround ? 1 - Math.exp(-13 * dt) : 1 - Math.exp(-3.2 * dt)
    this.vel.x += (wx - this.vel.x) * k
    this.vel.z += (wz - this.vel.z) * k

    if (this.keys['Space'] && this.onGround) {
      this.vel.y = 8.2
      this.onGround = false
      this.sfx.jump()
    }
    this.vel.y -= 24 * dt
    this.pos.y += this.vel.y * dt
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true }

    collideMove(this.pos, this.vel.x * dt, this.vel.z * dt, 0.42, this.map.colliders, this.map.bounds)

    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    if (this.onGround && hSpeed > 0.6) {
      this.bobT += hSpeed * dt * 1.5
      this.stepAcc += hSpeed * dt
      const stride = walk ? 2.4 : 1.9
      if (this.stepAcc > stride) { this.stepAcc = 0; this.sfx.step() }
    }
    const bob = this.onGround && hSpeed > 0.6 ? Math.sin(this.bobT * 2) * 0.032 * Math.min(1, hSpeed / 5) : 0

    // camera
    const shX = (Math.random() - 0.5) * this.shake * 0.05
    const shY = (Math.random() - 0.5) * this.shake * 0.05
    const shR = (Math.random() - 0.5) * this.shake * 0.03
    this.camera.position.set(this.pos.x + shX, this.pos.y + 1.55 + bob + shY, this.pos.z)
    this.camera.rotation.set(this.pitch + this.recoilPitch + shY * 0.4, this.yaw + this.recoilYaw, shR)

    // weapon anim
    const w = this.weapon
    const targetX = 0.24 + Math.sin(this.bobT) * 0.006 * Math.min(1, hSpeed / 5) - this.vel.x * 0.004 * cos - this.vel.z * 0.004 * -sin
    w.position.x += (targetX - w.position.x) * Math.min(1, 12 * dt)
    w.position.y = -0.22 + Math.abs(Math.cos(this.bobT)) * 0.008 * Math.min(1, hSpeed / 5)
    w.position.z = -0.45 + this.kick * 0.055
    let rotX = this.kick * 0.1
    if (this.reloading) rotX -= Math.sin(Math.min(1, 1 - this.reloadT / 1.9) * Math.PI) * 0.85
    w.rotation.x = rotX
    w.rotation.z = this.kick * 0.02

    // spread
    const moving = hSpeed > 1.2
    this.spread = Math.max(0, this.spread - dt * (moving ? 1.4 : 4.2) - (this.onGround && !moving ? dt * 1.5 : 0) - (walk ? dt * 0.8 : 0))

    // timers
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (this.reloading) {
      this.reloadT -= dt
      if (this.reloadT <= 0) {
        this.reloading = false
        const take = Math.min(MAG_SIZE - this.mag, this.res)
        this.mag += take
        this.res -= take
      }
    }
    if (this.firing) this.tryShoot()

    // ---- bots ----
    const eye = this.tmpV.set(this.pos.x, this.pos.y + 1.55, this.pos.z)
    let alive = 0
    for (let i = this.bots.length - 1; i >= 0; i--) {
      const b = this.bots[i]
      const keep = b.update(dt, eye)
      if (b.alive) alive++
      if (!keep) {
        b.dispose(this.scene)
        this.bots.splice(i, 1)
      }
    }
    // separation
    for (let i = 0; i < this.bots.length; i++) {
      for (let j = i + 1; j < this.bots.length; j++) {
        const a = this.bots[i].group.position
        const c = this.bots[j].group.position
        const dx = c.x - a.x
        const dz = c.z - a.z
        const d = Math.hypot(dx, dz)
        if (d < 0.9 && d > 0.001) {
          const push = ((0.9 - d) / 2)
          a.x -= (dx / d) * push
          a.z -= (dz / d) * push
          c.x += (dx / d) * push
          c.z += (dz / d) * push
        }
      }
    }

    this.updateNades(dt)

    // ---- round timer / end ----
    this.roundT -= dt
    if (alive === 0 && this.bots.every((b) => !b.alive)) {
      // wait a beat so death anim starts
      this.roundT = Math.max(this.roundT, 0.9)
      this.endRound(true)
    } else if (this.roundT <= 0) {
      this.roundT = 0
      this.endRound(false)
    }

    // ---- hud ----
    this.hooks.hud({
      hp: Math.max(0, Math.ceil(this.hp)),
      armor: Math.max(0, Math.ceil(this.armor)),
      mag: this.mag,
      res: this.res,
      nades: this.nades,
      timer: Math.max(0, Math.ceil(this.roundT)),
      spreadPx: Math.round(5 + this.spread * 30 + (moving ? 4 : 0)),
      enemies: alive,
      reloading: this.reloading,
    })
    this.hooks.radar({
      px: this.pos.x,
      pz: this.pos.z,
      yaw: this.yaw,
      dots: this.bots.filter((b) => b.alive).map((b) => ({ x: b.group.position.x, z: b.group.position.z })),
    })
  }
}
