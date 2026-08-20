import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { buildMap, collideMove, type MapData } from './map'
import { Bot, type BotHooks } from './bots'
import { SFX } from './audio'

export interface HudData {
  hp: number; armor: number; mag: number; res: number; nades: number
  timer: number; spreadPx: number; enemies: number; reloading: boolean
  weapon: string; melee: boolean
}
export interface FeedEntry { id: number; killer: string; victim: string; head: boolean; byPlayer: boolean }
export interface BannerData { title: string; sub?: string; tone: 'win' | 'lose' | 'info' }
export interface OverData { result: 'victory' | 'defeat'; kills: number; deaths: number; won: number; lost: number }
export interface RadarData { px: number; pz: number; yaw: number; dots: { x: number; z: number }[] }
export interface WheelItem { id: WeaponId; name: string; short: string; cat: string }
export interface WheelState { items: WheelItem[]; active: number }

export interface GameHooks {
  wheel(w: WheelState | null): void
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
  scoped(s: boolean): void
}

type State = 'attract' | 'playing' | 'roundEnd' | 'dying' | 'paused'

const NAMES = ['Феникс', 'Гюрза', 'Кобра', 'Шакал', 'Коршун', 'Таран', 'Волк', 'Гадюка', 'Беркут', 'Росомаха']
const ROUND_TIME = 100
const WINS_NEEDED = 3

export type WeaponId =
  | 'glock' | 'usp' | 'p250' | 'deagle' | 'r8'
  | 'mp9' | 'mac10' | 'ump45' | 'p90'
  | 'ak' | 'm4a4' | 'famas' | 'aug'
  | 'awp' | 'ssg08'
  | 'nova' | 'negev'
  | 'zeus' | 'knife'

export type SoundKind = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'lmg' | 'zeus' | 'knife'
type GunKind = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'lmg' | 'zeus' | 'knife'

export interface GunSpec {
  kind: GunKind
  body: number      // длина ствольной коробки
  bodyH: number     // высота
  bodyColor: number
  accent: number    // цевьё/приклад
  barrel: number    // длина ствола
  stock: number     // длина приклада (0 = нет)
  mag: number       // длина магазина (0 = нет)
  scope?: number    // кратность оптики
  drum?: boolean    // дисковый магазин
}

interface WeaponDef {
  name: string; short: string; cat: string
  dmg: number; cd: number; mag: number; res: number
  auto: boolean; reload: number; recoil: number; recoilYaw: number
  kick: number; base: number; grow: number; movePen: number; recover: number
  speed: number; reward: number; sound: SoundKind; melee?: boolean; gun: GunSpec
}

const C = { gunmetal: 0x26282c, dark: 0x1b1d20, wood: 0x7c4a24, green: 0x42503a, tan: 0x8a7a55, blue: 0x3a4a5c, olive: 0x57613c, black: 0x151619, steel: 0x5a6066 }

const WEAPONS: Record<WeaponId, WeaponDef> = {
  // пистолеты
  glock:  { name: 'Glock-18', short: 'GLOCK', cat: 'Пистолет', dmg: 19, cd: 0.15, mag: 20, res: 120, auto: false, reload: 2.2, recoil: 0.02,  recoilYaw: 0.005, kick: 0.07, base: 0.004, grow: 0.04, movePen: 0.03, recover: 3.0, speed: 1.03, reward: 300, sound: 'pistol', gun: { kind: 'pistol', body: 0.30, bodyH: 0.062, bodyColor: C.dark, accent: C.dark, barrel: 0.07, stock: 0, mag: 0.15 } },
  usp:    { name: 'USP-S', short: 'USP-S', cat: 'Пистолет', dmg: 23, cd: 0.17, mag: 12, res: 24, auto: false, reload: 2.2, recoil: 0.022, recoilYaw: 0.004, kick: 0.06, base: 0.0035, grow: 0.035, movePen: 0.03, recover: 3.2, speed: 1.03, reward: 300, sound: 'pistol', gun: { kind: 'pistol', body: 0.30, bodyH: 0.062, bodyColor: C.gunmetal, accent: C.gunmetal, barrel: 0.10, stock: 0, mag: 0.14 } },
  p250:   { name: 'P250', short: 'P250', cat: 'Пистолет', dmg: 21, cd: 0.16, mag: 13, res: 26, auto: false, reload: 2.2, recoil: 0.021, recoilYaw: 0.005, kick: 0.065, base: 0.004, grow: 0.04, movePen: 0.03, recover: 3.0, speed: 1.03, reward: 300, sound: 'pistol', gun: { kind: 'pistol', body: 0.28, bodyH: 0.060, bodyColor: C.steel, accent: C.dark, barrel: 0.07, stock: 0, mag: 0.13 } },
  deagle: { name: 'Desert Eagle', short: 'DEAGLE', cat: 'Пистолет', dmg: 53, cd: 0.24, mag: 7, res: 35, auto: false, reload: 2.2, recoil: 0.038, recoilYaw: 0.006, kick: 0.1, base: 0.004, grow: 0.05, movePen: 0.035, recover: 2.4, speed: 1.02, reward: 300, sound: 'pistol', gun: { kind: 'pistol', body: 0.32, bodyH: 0.066, bodyColor: C.dark, accent: C.gunmetal, barrel: 0.09, stock: 0, mag: 0.16 } },
  r8:     { name: 'R8 Revolver', short: 'R8', cat: 'Пистолет', dmg: 60, cd: 0.5, mag: 8, res: 8, auto: false, reload: 3.0, recoil: 0.045, recoilYaw: 0.006, kick: 0.12, base: 0.003, grow: 0.045, movePen: 0.03, recover: 2.2, speed: 1.02, reward: 300, sound: 'pistol', gun: { kind: 'pistol', body: 0.30, bodyH: 0.07, bodyColor: C.steel, accent: C.dark, barrel: 0.11, stock: 0, mag: 0 } },
  // пистолеты-пулемёты
  mp9:    { name: 'MP9', short: 'MP9', cat: 'ПП', dmg: 16, cd: 0.07, mag: 30, res: 120, auto: true, reload: 2.1, recoil: 0.009, recoilYaw: 0.007, kick: 0.09, base: 0.0045, grow: 0.018, movePen: 0.012, recover: 3.6, speed: 1.04, reward: 600, sound: 'smg', gun: { kind: 'smg', body: 0.34, bodyH: 0.07, bodyColor: C.dark, accent: C.gunmetal, barrel: 0.10, stock: 0.12, mag: 0.16 } },
  mac10:  { name: 'MAC-10', short: 'MAC-10', cat: 'ПП', dmg: 15, cd: 0.075, mag: 30, res: 100, auto: true, reload: 2.6, recoil: 0.01, recoilYaw: 0.009, kick: 0.08, base: 0.0055, grow: 0.02, movePen: 0.014, recover: 3.4, speed: 1.04, reward: 600, sound: 'smg', gun: { kind: 'smg', body: 0.30, bodyH: 0.08, bodyColor: C.gunmetal, accent: C.dark, barrel: 0.08, stock: 0.14, mag: 0.17 } },
  ump45:  { name: 'UMP-45', short: 'UMP-45', cat: 'ПП', dmg: 19, cd: 0.09, mag: 25, res: 100, auto: true, reload: 3.5, recoil: 0.011, recoilYaw: 0.007, kick: 0.09, base: 0.005, grow: 0.019, movePen: 0.013, recover: 3.5, speed: 1.03, reward: 600, sound: 'smg', gun: { kind: 'smg', body: 0.36, bodyH: 0.075, bodyColor: C.dark, accent: C.gunmetal, barrel: 0.12, stock: 0.16, mag: 0.15 } },
  p90:    { name: 'P90', short: 'P90', cat: 'ПП', dmg: 14, cd: 0.066, mag: 50, res: 100, auto: true, reload: 3.3, recoil: 0.008, recoilYaw: 0.007, kick: 0.07, base: 0.005, grow: 0.016, movePen: 0.013, recover: 3.8, speed: 1.04, reward: 600, sound: 'smg', gun: { kind: 'smg', body: 0.40, bodyH: 0.09, bodyColor: C.tan, accent: C.dark, barrel: 0.08, stock: 0, mag: 0.1, drum: true } },
  // винтовки
  ak:     { name: 'AK-47', short: 'AK-47', cat: 'Винтовка', dmg: 27, cd: 0.096, mag: 30, res: 90, auto: true, reload: 2.5, recoil: 0.013, recoilYaw: 0.008, kick: 0.16, base: 0.0035, grow: 0.02, movePen: 0.006, recover: 4.2, speed: 1.0, reward: 300, sound: 'rifle', gun: { kind: 'rifle', body: 0.44, bodyH: 0.085, bodyColor: C.gunmetal, accent: C.wood, barrel: 0.30, stock: 0.24, mag: 0.20 } },
  m4a4:   { name: 'M4A4', short: 'M4A4', cat: 'Винтовка', dmg: 23, cd: 0.09, mag: 30, res: 90, auto: true, reload: 3.1, recoil: 0.011, recoilYaw: 0.007, kick: 0.13, base: 0.0032, grow: 0.018, movePen: 0.006, recover: 4.4, speed: 1.0, reward: 300, sound: 'rifle', gun: { kind: 'rifle', body: 0.44, bodyH: 0.08, bodyColor: C.dark, accent: C.gunmetal, barrel: 0.32, stock: 0.22, mag: 0.17 } },
  famas:  { name: 'FAMAS', short: 'FAMAS', cat: 'Винтовка', dmg: 21, cd: 0.096, mag: 25, res: 90, auto: true, reload: 3.3, recoil: 0.01, recoilYaw: 0.007, kick: 0.12, base: 0.0034, grow: 0.018, movePen: 0.006, recover: 4.2, speed: 1.0, reward: 300, sound: 'rifle', gun: { kind: 'rifle', body: 0.48, bodyH: 0.08, bodyColor: C.blue, accent: C.dark, barrel: 0.26, stock: 0.14, mag: 0.16 } },
  aug:    { name: 'AUG', short: 'AUG', cat: 'Винтовка', dmg: 22, cd: 0.096, mag: 30, res: 90, auto: true, reload: 3.8, recoil: 0.011, recoilYaw: 0.007, kick: 0.12, base: 0.003, grow: 0.018, movePen: 0.006, recover: 4.2, speed: 0.99, reward: 300, sound: 'rifle', gun: { kind: 'rifle', body: 0.46, bodyH: 0.085, bodyColor: C.olive, accent: C.dark, barrel: 0.24, stock: 0.20, mag: 0.16, scope: 2 } },
  // снайперские
  awp:    { name: 'AWP', short: 'AWP', cat: 'Снайперка', dmg: 115, cd: 1.35, mag: 5, res: 30, auto: false, reload: 3.7, recoil: 0.09, recoilYaw: 0.004, kick: 0.05, base: 0.0012, grow: 0.03, movePen: 0, recover: 1.1, speed: 0.88, reward: 100, sound: 'sniper', gun: { kind: 'sniper', body: 0.60, bodyH: 0.085, bodyColor: C.green, accent: C.green, barrel: 0.50, stock: 0.26, mag: 0.12, scope: 4 } },
  ssg08:  { name: 'SSG 08', short: 'SSG 08', cat: 'Снайперка', dmg: 70, cd: 1.2, mag: 10, res: 90, auto: false, reload: 3.0, recoil: 0.07, recoilYaw: 0.004, kick: 0.06, base: 0.0013, grow: 0.028, movePen: 0, recover: 1.4, speed: 0.95, reward: 100, sound: 'sniper', gun: { kind: 'sniper', body: 0.56, bodyH: 0.075, bodyColor: C.blue, accent: C.dark, barrel: 0.48, stock: 0.24, mag: 0.10, scope: 4 } },
  // дробовик / пулемёт
  nova:   { name: 'Nova', short: 'NOVA', cat: 'Дробовик', dmg: 56, cd: 0.9, mag: 8, res: 32, auto: false, reload: 3.5, recoil: 0.05, recoilYaw: 0.01, kick: 0.14, base: 0.008, grow: 0.06, movePen: 0.02, recover: 2.0, speed: 0.97, reward: 900, sound: 'shotgun', gun: { kind: 'shotgun', body: 0.50, bodyH: 0.08, bodyColor: C.gunmetal, accent: C.wood, barrel: 0.40, stock: 0.24, mag: 0 } },
  negev:  { name: 'Negev', short: 'NEGEV', cat: 'Пулемёт', dmg: 16, cd: 0.06, mag: 100, res: 200, auto: true, reload: 5.5, recoil: 0.012, recoilYaw: 0.01, kick: 0.11, base: 0.008, grow: 0.024, movePen: 0.01, recover: 2.8, speed: 0.92, reward: 800, sound: 'lmg', gun: { kind: 'lmg', body: 0.48, bodyH: 0.09, bodyColor: C.gunmetal, accent: C.dark, barrel: 0.34, stock: 0.22, mag: 0.14, drum: true } },
  // особое
  zeus:   { name: 'Zeus x27', short: 'ZEUS', cat: 'Особое', dmg: 195, cd: 2.0, mag: 1, res: 0, auto: false, reload: 0, recoil: 0.02, recoilYaw: 0.004, kick: 0.1, base: 0.002, grow: 0.02, movePen: 0, recover: 2.0, speed: 1.03, reward: 0, sound: 'zeus', gun: { kind: 'zeus', body: 0.26, bodyH: 0.07, bodyColor: C.steel, accent: 0xd8b400, barrel: 0.06, stock: 0, mag: 0.14 } },
  knife:  { name: 'M48 Tomahawk', short: 'НОЖ', cat: 'Ближний бой', dmg: 60, cd: 0.45, mag: 0, res: 0, auto: true, reload: 0, recoil: 0, recoilYaw: 0, kick: 0.05, base: 0, grow: 0, movePen: 0, recover: 5, speed: 1.06, reward: 1500, sound: 'knife', melee: true, gun: { kind: 'knife', body: 0.30, bodyH: 0.05, bodyColor: C.dark, accent: C.wood, barrel: 0.22, stock: 0, mag: 0 } },
}

export const WEAPON_ORDER: WeaponId[] = [
  'ak', 'm4a4', 'famas', 'aug',
  'awp', 'ssg08',
  'mp9', 'mac10', 'ump45', 'p90',
  'nova', 'negev',
  'glock', 'usp', 'p250', 'deagle', 'r8',
  'zeus', 'knife',
]

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
  private armor = 0
  private nades = 1
  private reloading = false
  private reloadT = 0
  private reloadTotal = 1.9
  private cooldown = 0
  private firing = false

  // weapons
  private equipped: WeaponId = 'deagle'
  private ammo: Record<WeaponId, { mag: number; res: number }> = {} as Record<WeaponId, { mag: number; res: number }>
  private scoped = false
  private switchAnim = 1
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
  private shells: { m: THREE.Mesh; v: THREE.Vector3; rv: THREE.Vector3; life: number }[] = []
  private decals: { m: THREE.Mesh; life: number }[] = []
  private composer: EffectComposer

  // fx objects
  private weapon = new THREE.Group()
  private weaponModels: Record<WeaponId, THREE.Group> = {} as Record<WeaponId, THREE.Group>
  private weaponMuzzles: Record<WeaponId, THREE.Object3D> = {} as Record<WeaponId, THREE.Object3D>
  private wheelOpen = false
  private wheelIndex = 0
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.06

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

    this.buildWeapons()
    this.flash = this.buildFlash(0.55)
    this.weaponMuzzles[this.equipped].add(this.flash)

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

    // гильзы
    const shellGeo = new THREE.BoxGeometry(0.016, 0.05, 0.016)
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.85, roughness: 0.35 })
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat)
      m.visible = false
      this.scene.add(m)
      this.shells.push({ m, v: new THREE.Vector3(), rv: new THREE.Vector3(), life: 0 })
    }
    // декали попаданий
    const decalGeo = new THREE.PlaneGeometry(0.1, 0.1)
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ color: 0x14100a, transparent: true, opacity: 0, depthWrite: false }))
      m.visible = false
      this.scene.add(m)
      this.decals.push({ m, life: 0 })
    }

    // постобработка: bloom + тонмаппинг
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.5, 0.5, 0.82))
    this.composer.addPass(new OutputPass())

    this.pos.set(this.map.playerSpawn.x, 0, this.map.playerSpawn.z)
    this.bindEvents()
    this.loop()
  }

  /* ================= weapon ================= */

  private gunMat(color: number, metal = true) {
    return new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.5 : 0.72, metalness: metal ? 0.6 : 0.15 })
  }

  // процедурная сборка ствола из коробки/цилиндров по спецификации
  private buildGunModel(spec: GunSpec): { group: THREE.Group; muzzle: THREE.Object3D } {
    const g = new THREE.Group()
    const muzzle = new THREE.Object3D()
    const body = this.gunMat(spec.bodyColor)
    const accent = this.gunMat(spec.accent, false)
    const dark = this.gunMat(0x141519)

    const box = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m)
      mesh.position.set(x, y, z)
      mesh.rotation.x = rx
      g.add(mesh)
      return mesh
    }
    const cyl = (r: number, l: number, m: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'x') => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), m)
      if (axis === 'x') mesh.rotation.x = Math.PI / 2
      if (axis === 'z') mesh.rotation.z = Math.PI / 2
      mesh.position.set(x, y, z)
      g.add(mesh)
      return mesh
    }

    const bh = spec.bodyH
    const W = 0.062

    // ---- нож (томагавк) ----
    if (spec.kind === 'knife') {
      const handle = cyl(0.013, spec.body, accent, 0, 0, 0.1, 'y')
      handle.rotation.z = -0.4
      box(0.018, 0.13, 0.15, this.gunMat(0x9aa0a8), 0, 0.15, -0.04)      // лезвие
      box(0.016, 0.06, 0.05, dark, 0, 0.07, -0.04)                        // шейка
      box(0.014, 0.04, 0.05, this.gunMat(0x9aa0a8), 0, 0.14, 0.04)         // обух-клык
      muzzle.position.set(0, 0.12, -0.06)
      g.add(muzzle)
      return { group: g, muzzle }
    }

    // ---- Zeus (электрошокер) ----
    if (spec.kind === 'zeus') {
      box(W, bh, spec.body, body, 0, 0, spec.body / 2)
      box(0.05, 0.13, 0.06, body, 0, -bh / 2 - 0.05, spec.body * 0.72, 0.25)
      box(W * 0.9, bh * 0.55, 0.05, this.gunMat(spec.accent, false), 0, 0, -0.012)
      cyl(0.006, 0.06, this.gunMat(spec.accent), -0.016, bh * 0.16, -0.05)
      cyl(0.006, 0.06, this.gunMat(spec.accent), 0.016, bh * 0.16, -0.05)
      muzzle.position.set(0, bh * 0.16, -0.08)
      g.add(muzzle)
      return { group: g, muzzle }
    }

    // ---- общее огнестрельное ----
    box(W, bh, spec.body, body, 0, 0, spec.body / 2)                       // ствольная коробка

    const barrelR = spec.kind === 'shotgun' ? 0.024 : spec.kind === 'sniper' ? 0.015 : spec.kind === 'pistol' ? 0.012 : 0.016
    cyl(barrelR, spec.barrel, dark, 0, bh * 0.12, -spec.barrel / 2)        // ствол

    if (spec.kind === 'shotgun') {                                          // подствольный магазин + цевьё-помпа
      cyl(0.019, spec.barrel * 0.8, body, 0, -bh * 0.2, -spec.barrel * 0.4)
      box(W * 0.95, 0.055, 0.11, accent, 0, -bh * 0.2, -spec.barrel * 0.66)
    }

    if (spec.kind !== 'pistol') {                                           // цевьё, планка, мушка
      box(W * 0.95, bh * 0.82, spec.barrel * 0.45, accent, 0, bh * 0.05, -spec.barrel * 0.24)
      box(0.03, 0.026, spec.barrel * 0.5, dark, 0, bh * 0.5 + 0.012, -spec.barrel * 0.3)
      box(0.012, 0.045, 0.012, dark, 0, bh * 0.5 + 0.032, -spec.barrel * 0.85)
    }

    if (spec.stock > 0) box(W * 0.85, bh * 0.95, spec.stock, accent, 0, 0, spec.body + spec.stock / 2)  // приклад

    box(0.05, 0.11, 0.055, body, 0, -bh / 2 - 0.05, spec.body * 0.72, 0.25) // рукоять

    if (spec.drum) cyl(0.055, 0.075, dark, 0, -bh / 2 - 0.02, spec.body * 0.35, 'z')  // дисковый магазин
    else if (spec.mag > 0) box(0.05, spec.mag, 0.07, dark, 0, -bh / 2 - spec.mag / 2 + 0.01, spec.body * 0.35, -0.16)

    if (spec.scope) {                                                        // оптика
      cyl(0.03, 0.22, dark, 0, bh / 2 + 0.055, spec.body * 0.3)
      cyl(0.036, 0.05, body, 0, bh / 2 + 0.055, spec.body * 0.3 + 0.12)
      box(0.012, 0.05, 0.012, dark, 0, bh / 2 + 0.02, spec.body * 0.3)
    } else if (spec.kind === 'pistol') {
      box(0.012, 0.028, 0.012, dark, 0, bh * 0.5 + 0.02, -spec.barrel * 0.7)
      box(0.04, 0.02, 0.014, dark, 0, bh * 0.5 + 0.015, spec.body * 0.8)
    } else {
      box(0.045, 0.024, 0.018, dark, 0, bh / 2 + 0.02, spec.body * 0.6)      // целик
    }

    const tipY = spec.kind === 'pistol' ? 0 : bh * 0.12
    muzzle.position.set(0, tipY, -spec.barrel - (spec.kind === 'sniper' ? 0.07 : 0.02))
    g.add(muzzle)
    return { group: g, muzzle }
  }

  private buildWeapons() {
    const root = this.weapon
    for (const id of WEAPON_ORDER) {
      const { group, muzzle } = this.buildGunModel(WEAPONS[id].gun)
      this.weaponModels[id] = group
      this.weaponMuzzles[id] = muzzle
      root.add(group)
      group.visible = false
    }
    root.position.set(0.24, -0.22, -0.45)
    this.camera.add(root)
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
    if (e.code === 'Tab') { e.preventDefault(); this.openWheel(); return }
    if (this.wheelOpen) return // в колесе выбора работают только Tab/цифры
    if (e.code === 'KeyR') this.startReload()
    if (e.code === 'KeyG') this.throwNade()
    const num = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(e.code)
    if (num >= 0 && num < WEAPON_ORDER.length) this.switchTo(WEAPON_ORDER[num])
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false
    if (e.code === 'Tab') { e.preventDefault(); this.closeWheel(true) }
  }
  private onWheel = (e: WheelEvent) => {
    if (this.state !== 'playing' || this.wheelOpen) return
    this.cycleWeapon(e.deltaY > 0 ? 1 : -1)
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.wheelOpen) { this.wheelPick(e.clientX, e.clientY); return }
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
      // ПКМ: прицел AWP, иначе огонь
      if (this.equipped === 'awp') this.toggleScope()
      else {
        this.firing = true
        this.tryShoot()
      }
    }
  }
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 2) this.firing = false
  }

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.renderer.domElement
    // при открытом колесе выбора захват освобождается намеренно — не паузим
    if (this.locked && !locked && this.state === 'playing' && !this.wheelOpen) this.pause()
    this.mouseInit = false
    this.locked = locked
    if (!this.wheelOpen) this.hooks.lockedChange(locked)
  }
  private onResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }
  private onVisibility = () => {
    if (document.hidden && this.state === 'playing') this.pause()
  }
  private onContext = (e: Event) => e.preventDefault()

  private bindEvents() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('wheel', this.onWheel, { passive: true })
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
    this.equipped = 'deagle'
    this.applyWeaponVisibility()
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
    if (this.scoped) this.toggleScope(false)
    if (document.pointerLockElement) document.exitPointerLock()
    else this.hooks.lockedChange(false)
  }

  toMenu() {
    window.clearTimeout(this.roundTimeout)
    this.clearEntities()
    this.state = 'attract'
    if (this.scoped) this.toggleScope(false)
    if (document.pointerLockElement) document.exitPointerLock()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('wheel', this.onWheel)
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
    // каждый раунд — полный боезапас всех стволов
    for (const id of WEAPON_ORDER) {
      this.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].res }
    }
    this.nades = Math.min(3, this.round)
    this.reloading = false
    this.firing = false
    this.scoped = false
    this.hooks.scoped(false)
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
      sub: `противников: ${count} · стволы: [1][2][3] / колесо`,
      tone: 'info',
    })
    this.sfx.beep(760, 0.12, 0.22)
    this.requestLock()
  }

  private endRound(won: boolean) {
    if (this.state !== 'playing' && this.state !== 'dying') return
    this.state = 'roundEnd'
    this.firing = false
    if (this.scoped) this.toggleScope(false)
    this.camera.fov = 75
    this.camera.updateProjectionMatrix()
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
    if (this.scoped) this.toggleScope(false)
    this.camera.fov = 75
    this.camera.updateProjectionMatrix()
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
    const cfg = WEAPONS[this.equipped]
    if (cfg.melee || cfg.reload <= 0) return // нож и Zeus не перезаряжаются
    const a = this.ammo[this.equipped]
    if (this.reloading || a.mag >= cfg.mag || this.state !== 'playing') return
    if (a.res <= 0) {
      a.res = cfg.mag
      this.hooks.feed({ killer: 'Снабжение', victim: `+${cfg.mag} патронов`, head: false, byPlayer: true })
    }
    if (this.scoped) this.toggleScope(false)
    this.reloading = true
    this.reloadTotal = cfg.reload
    this.reloadT = cfg.reload
    this.sfx.reload()
  }

  private tryShoot() {
    if (this.state !== 'playing' || this.cooldown > 0 || this.reloading || this.switchAnim < 1 || this.wheelOpen) return
    const cfg = WEAPONS[this.equipped]
    if (cfg.melee) { this.meleeAttack(cfg); return }
    const a = this.ammo[this.equipped]
    if (a.mag <= 0) {
      this.sfx.dry()
      this.firing = false
      if (cfg.reload > 0) this.startReload()
      return
    }
    a.mag--
    this.cooldown = cfg.cd
    if (cfg.sound === 'sniper') this.sfx.sniper()
    else if (cfg.sound === 'pistol') this.sfx.pistol()
    else if (cfg.sound === 'smg') this.sfx.smg()
    else if (cfg.sound === 'shotgun') this.sfx.shotgun()
    else if (cfg.sound === 'lmg') this.sfx.lmg()
    else if (cfg.sound === 'zeus') this.sfx.zeus()
    else this.sfx.shoot()

    // fx
    const big = cfg.sound === 'sniper' || cfg.sound === 'shotgun'
    this.flashT = big ? 0.07 : 0.04
    this.flash.rotation.z = Math.random() * Math.PI
    const fs = (big ? 1.2 : cfg.sound === 'pistol' ? 0.55 : 0.75) + Math.random() * 0.5
    this.flash.scale.set(fs, fs, fs)
    this.gunLight.intensity = big ? 40 : 26
    this.kick = Math.min(1.6, this.kick + 1)
    this.recoilPitch += cfg.recoil + Math.random() * cfg.recoil * 0.5
    this.recoilYaw += (Math.random() - 0.5) * cfg.recoilYaw * 2
    this.spread = Math.min(1, this.spread + (this.onGround ? cfg.kick : cfg.kick * 1.6))
    this.spawnShell()

    // hitscan
    this.camera.getWorldDirection(this.tmpD)
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    let spreadRad: number
    if (cfg.sound === 'sniper') {
      spreadRad = this.scoped ? 0.0012 + this.spread * 0.004 : 0.075 + this.spread * 0.03 + (hSpeed > 1.2 ? 0.05 : 0)
    } else {
      spreadRad = cfg.base + this.spread * cfg.grow + (hSpeed > 1.2 ? cfg.movePen : 0) + (this.onGround ? 0 : 0.012)
    }
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
    this.weaponMuzzles[this.equipped].getWorldPosition(muzzlePos)
    const end = hits.length ? hits[0].point : this.tmpV.clone().addScaledVector(this.tmpD, 120)
    this.spawnTracer(muzzlePos, end, cfg.sound === 'zeus' ? 0x7ad7ff : 0xffd27a)
    this.burst(muzzlePos, 0x9c9a90, 2, 0.6, 0.6, -2.2) // пороховой дым

    if (hits.length) {
      const ud = hits[0].object.userData as { bot?: Bot; part?: string }
      if (ud.bot && ud.bot.alive) {
        const head = ud.part === 'head'
        const killed = ud.bot.hit(ud.part || 'body', head ? cfg.dmg * 4 : cfg.dmg)
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
        if (hits[0].face) {
          const nrm = new THREE.Vector3().copy(hits[0].face.normal).transformDirection(hits[0].object.matrixWorld)
          this.addDecal(hits[0].point, nrm)
        }
      }
    }
  }

  private meleeAttack(cfg: WeaponDef) {
    this.cooldown = cfg.cd
    this.kick = Math.min(1.6, this.kick + 1)
    this.sfx.knife()
    this.camera.getWorldDirection(this.tmpD)
    this.camera.getWorldPosition(this.tmpV)
    this.ray.set(this.tmpV, this.tmpD)
    this.ray.far = 2.4
    const targets: THREE.Object3D[] = []
    for (const b of this.bots) if (b.alive) targets.push(...b.hitboxes)
    const hits = this.ray.intersectObjects(targets, false)
    if (hits.length) {
      const ud = hits[0].object.userData as { bot?: Bot; part?: string }
      if (ud.bot && ud.bot.alive) {
        const head = ud.part === 'head'
        const killed = ud.bot.hit(ud.part || 'body', head ? cfg.dmg * 2 : cfg.dmg)
        this.burst(hits[0].point, 0x9e1b1b, 14, 3.6, 0.5)
        if (killed) this.onBotKilled(ud.bot, head)
        else { this.hooks.hitmark(head ? 'head' : 'hit'); this.sfx.hit(head) }
      }
    }
  }

  private onBotKilled(bot: Bot, head: boolean) {
    this.kills++
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

  /* ================= weapons & shop ================= */

  private switchTo(w: WeaponId) {
    if (this.equipped === w || this.state !== 'playing') return
    this.equipped = w
    this.reloading = false
    this.firing = false
    if (this.scoped) this.toggleScope(false)
    this.switchAnim = 0
    this.applyWeaponVisibility()
    this.sfx.switchW()
  }

  private applyWeaponVisibility() {
    for (const id of WEAPON_ORDER) this.weaponModels[id].visible = id === this.equipped
    this.weaponMuzzles[this.equipped].add(this.flash)
  }

  private cycleWeapon(dir: number) {
    if (this.state !== 'playing') return
    const i = WEAPON_ORDER.indexOf(this.equipped)
    const n = WEAPON_ORDER.length
    this.switchTo(WEAPON_ORDER[(i + dir + n) % n])
  }

  private openWheel() {
    if (this.state !== 'playing' || this.wheelOpen) return
    this.wheelOpen = true
    this.firing = false
    this.wheelIndex = WEAPON_ORDER.indexOf(this.equipped)
    if (document.pointerLockElement) document.exitPointerLock()
    this.emitWheel()
  }

  private closeWheel(commit: boolean) {
    if (!this.wheelOpen) return
    this.wheelOpen = false
    if (commit) this.switchTo(WEAPON_ORDER[this.wheelIndex])
    this.hooks.wheel(null)
    this.requestLock()
  }

  private emitWheel() {
    this.hooks.wheel({
      items: WEAPON_ORDER.map((id) => ({ id, name: WEAPONS[id].name, short: WEAPONS[id].short, cat: WEAPONS[id].cat })),
      active: this.wheelIndex,
    })
  }

  private wheelPick(clientX: number, clientY: number) {
    if (!this.wheelOpen) return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const dx = clientX - cx
    const dy = clientY - cy
    if (Math.hypot(dx, dy) < 40) return // мёртвая зона в центре
    let ang = Math.atan2(dy, dx) + Math.PI / 2 // 0 = вверх
    if (ang < 0) ang += Math.PI * 2
    const n = WEAPON_ORDER.length
    this.wheelIndex = Math.round((ang / (Math.PI * 2)) * n) % n
    this.emitWheel()
  }

  private toggleScope(on?: boolean) {
    const sc = WEAPONS[this.equipped].gun.scope
    if (!sc && on !== false) return
    const next = on !== undefined ? on : !this.scoped
    if (next === this.scoped) return
    this.scoped = next
    this.spread = Math.min(this.spread, 0.15)
    this.sfx.zoom(next)
    this.hooks.scoped(next)
  }

  private spawnShell() {
    const s = this.shells.find((q) => q.life <= 0)
    if (!s) return
    s.m.visible = true
    this.camera.getWorldPosition(this.tmpV)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    s.m.position.copy(this.tmpV).addScaledVector(right, 0.22).addScaledVector(up, -0.1).addScaledVector(fwd, 0.2)
    s.v.copy(right).multiplyScalar(1.6 + Math.random() * 1.2).addScaledVector(up, 1.6 + Math.random() * 1.4).addScaledVector(fwd, 0.5)
    s.rv.set((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25)
    s.life = 1.1
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3) {
    const d = this.decals.find((q) => q.life <= 0)
    if (!d) return
    d.m.position.copy(point).addScaledVector(normal, 0.015)
    d.m.lookAt(this.tmpV.copy(point).add(normal))
    d.m.rotation.z = Math.random() * Math.PI
    const sc = 0.7 + Math.random() * 0.9
    d.m.scale.set(sc, sc, sc)
    d.m.visible = true
    d.life = 7
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
    // гильзы
    for (const s of this.shells) {
      if (s.life <= 0) continue
      s.life -= dt
      if (s.life <= 0) { s.m.visible = false; continue }
      s.v.y -= 13 * dt
      s.m.position.addScaledVector(s.v, dt)
      if (s.m.position.y < 0.02) {
        s.m.position.y = 0.02
        s.v.y = Math.abs(s.v.y) * 0.35
        s.v.x *= 0.6
        s.v.z *= 0.6
        s.rv.multiplyScalar(0.5)
      }
      s.m.rotation.x += s.rv.x * dt
      s.m.rotation.y += s.rv.y * dt
      s.m.rotation.z += s.rv.z * dt
    }
    // декали попаданий
    for (const d of this.decals) {
      if (d.life <= 0) continue
      d.life -= dt
      if (d.life <= 0) { d.m.visible = false; continue }
      ;(d.m.material as THREE.MeshBasicMaterial).opacity = Math.min(0.7, d.life * 0.5)
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
    const clouds = this.scene.getObjectByName('clouds')
    if (clouds) clouds.rotation.y += dt * 0.007

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

    this.composer.render()
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
    const wcfg = WEAPONS[this.equipped]
    const speed = (walk ? 2.6 : 5.7) * wcfg.speed * (this.scoped ? 0.42 : 1)
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

    // scope fov
    const targetFov = this.scoped ? 18 : 75
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 16 * dt)
      this.camera.updateProjectionMatrix()
    }

    // weapon anim
    const w = this.weapon
    w.visible = !this.scoped
    const dip = Math.sin(Math.min(1, this.switchAnim) * Math.PI) * (this.switchAnim >= 1 ? 0 : 0.16)
    const targetX = 0.24 + Math.sin(this.bobT) * 0.006 * Math.min(1, hSpeed / 5) - this.vel.x * 0.004 * cos - this.vel.z * 0.004 * -sin
    w.position.x += (targetX - w.position.x) * Math.min(1, 12 * dt)
    w.position.y = -0.22 + Math.abs(Math.cos(this.bobT)) * 0.008 * Math.min(1, hSpeed / 5) - dip
    w.position.z = -0.45 + this.kick * 0.055
    let rotX = this.kick * 0.1
    if (this.reloading) rotX -= Math.sin(Math.min(1, 1 - this.reloadT / this.reloadTotal) * Math.PI) * 0.85
    if (this.switchAnim < 1) rotX -= Math.sin(this.switchAnim * Math.PI) * 0.5
    w.rotation.x = rotX
    w.rotation.z = this.kick * 0.02

    // spread
    const moving = hSpeed > 1.2
    this.spread = Math.max(0, this.spread - dt * wcfg.recover * (moving ? 0.45 : 1) - (this.onGround && !moving ? dt * 1.2 : 0))

    // timers
    const cfg = WEAPONS[this.equipped]
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.switchAnim = Math.min(1, this.switchAnim + dt / 0.28)
    if (this.reloading) {
      this.reloadT -= dt
      if (this.reloadT <= 0) {
        this.reloading = false
        const a = this.ammo[this.equipped]
        const take = Math.min(cfg.mag - a.mag, a.res)
        a.mag += take
        a.res -= take
      }
    }
    if (this.firing && cfg.auto) this.tryShoot()

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
    const ammoNow = this.ammo[this.equipped]
    this.hooks.hud({
      hp: Math.max(0, Math.ceil(this.hp)),
      armor: Math.max(0, Math.ceil(this.armor)),
      mag: ammoNow.mag,
      res: ammoNow.res,
      nades: this.nades,
      timer: Math.max(0, Math.ceil(this.roundT)),
      spreadPx: Math.round(this.scoped ? 2 : 5 + this.spread * 30 + (moving ? 4 : 0)),
      enemies: alive,
      reloading: this.reloading,
      weapon: `${WEAPON_ORDER.indexOf(this.equipped) + 1}·${WEAPONS[this.equipped].short}`,
      melee: !!WEAPONS[this.equipped].melee,
    })
    this.hooks.radar({
      px: this.pos.x,
      pz: this.pos.z,
      yaw: this.yaw,
      dots: this.bots.filter((b) => b.alive).map((b) => ({ x: b.group.position.x, z: b.group.position.z })),
    })
  }
}
