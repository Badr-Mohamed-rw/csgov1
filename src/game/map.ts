import * as THREE from 'three'

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; top: number }

export interface MapData {
  solids: THREE.Mesh[]
  colliders: AABB[]
  bounds: AABB
  botSpawns: { x: number; z: number }[]
  playerSpawn: { x: number; z: number }
}

export const STEP_HEIGHT = 0.45   // автоподъём (поребрики, мешки)
export const SNAP_DOWN = 0.6      // диапазон «прилипания» к опоре при падении

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, rx = 1, ry = 1) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  draw(g, size)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function speckle(g: CanvasRenderingContext2D, s: number, n: number, colors: string[], alpha: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0]
    g.globalAlpha = alpha * (0.4 + Math.random() * 0.6)
    const r = 1 + Math.random() * 2.4
    g.fillRect(Math.random() * s, Math.random() * s, r, r)
  }
  g.globalAlpha = 1
}

/* --- движение с учётом высоты препятствий: низкие можно перешагнуть --- */
export function collideMove(pos: THREE.Vector3, dx: number, dz: number, r: number, cols: AABB[], bounds?: AABB) {
  const step = STEP_HEIGHT
  let nx = pos.x + dx
  for (const c of cols) {
    if (c.top <= pos.y + step) continue
    if (nx + r > c.minX && nx - r < c.maxX && pos.z + r > c.minZ && pos.z - r < c.maxZ) {
      if (dx > 0) nx = Math.min(nx, c.minX - r)
      else if (dx < 0) nx = Math.max(nx, c.maxX + r)
    }
  }
  pos.x = nx
  let nz = pos.z + dz
  for (const c of cols) {
    if (c.top <= pos.y + step) continue
    if (pos.x + r > c.minX && pos.x - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) {
      if (dz > 0) nz = Math.min(nz, c.minZ - r)
      else if (dz < 0) nz = Math.max(nz, c.maxZ + r)
    }
  }
  pos.z = nz
  if (bounds) {
    pos.x = Math.max(bounds.minX + r, Math.min(bounds.maxX - r, pos.x))
    pos.z = Math.max(bounds.minZ + r, Math.min(bounds.maxZ - r, pos.z))
  }
}

/* --- высота опоры под игроком (земля = 0, верх ящика = его top) --- */
export function groundSupport(x: number, z: number, feetY: number, r: number, cols: AABB[]): number {
  let sup = 0
  for (const c of cols) {
    if (c.top <= feetY + SNAP_DOWN && c.top > sup &&
      x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) {
      sup = c.top
    }
  }
  return sup
}

export function buildMap(scene: THREE.Scene): MapData {
  const solids: THREE.Mesh[] = []
  const colliders: AABB[] = []

  /* ================= текстуры ================= */

  const sandTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c2a878'
    g.fillRect(0, 0, s, s)
    speckle(g, s, 3200, ['#b09463', '#d4bc8c', '#a8895a', '#cbb283', '#9b7f50'], 0.5)
    // пятна
    g.globalAlpha = 0.15
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#8f7448' : '#dcc596'
      g.beginPath()
      g.ellipse(Math.random() * s, Math.random() * s, 18 + Math.random() * 44, 10 + Math.random() * 28, Math.random() * 3, 0, 7)
      g.fill()
    }
    // трещины
    g.globalAlpha = 0.2
    g.strokeStyle = '#7d6238'
    g.lineWidth = 1.2
    for (let i = 0; i < 9; i++) {
      let x = Math.random() * s
      let y = Math.random() * s
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 44
        y += (Math.random() - 0.5) * 44
        g.lineTo(x, y)
      }
      g.stroke()
    }
    // камешки
    g.globalAlpha = 0.5
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ['#8d7a52', '#a3906a', '#6f5c3a'][(Math.random() * 3) | 0]
      g.beginPath()
      g.ellipse(Math.random() * s, Math.random() * s, 1.6 + Math.random() * 2.6, 1.2 + Math.random() * 2, Math.random() * 3, 0, 7)
      g.fill()
    }
    // следы колёс
    g.globalAlpha = 0.1
    g.strokeStyle = '#6e5a38'
    g.lineWidth = 9
    for (const off of [0, 26]) {
      g.beginPath()
      g.moveTo(off, 0)
      g.bezierCurveTo(off + 40, s * 0.3, off - 30, s * 0.7, off + 20, s)
      g.stroke()
    }
    g.globalAlpha = 1
  }, 9, 9)

  // песчаниковая кладка (стены Dust II)
  const brickTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c9b183'
    g.fillRect(0, 0, s, s)
    const bh = 32
    const bw = 64
    for (let row = 0; row < s / bh; row++) {
      const shift = row % 2 ? bw / 2 : 0
      for (let col = -1; col < s / bw + 1; col++) {
        const x = col * bw + shift
        const y = row * bh
        const tone = 0.9 + Math.random() * 0.2
        g.fillStyle = `rgb(${(201 * tone) | 0},${(177 * tone) | 0},${(131 * tone) | 0})`
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4)
        speckle(g, s, 26, ['#b39a6c', '#d8c39a', '#a58c5e'], 0.35)
        g.globalAlpha = 0.25
        g.fillStyle = '#8f7a52'
        g.fillRect(x + 2, y + bh - 5, bw - 4, 3)
        g.globalAlpha = 1
      }
      g.fillStyle = '#a08a5f'
      g.fillRect(0, row * bh, s, 2)
    }
    // потёки и грязь
    g.globalAlpha = 0.14
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * s
      g.fillStyle = '#6e5b3d'
      g.fillRect(x, 0, 4 + Math.random() * 9, 30 + Math.random() * 90)
    }
    g.globalAlpha = 1
  }, 5, 2)

  const crateTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#8a5c2e'
    g.fillRect(0, 0, s, s)
    // доски с текстурой дерева
    for (let y = 0; y < s; y += 42) {
      const tone = 0.92 + Math.random() * 0.16
      g.fillStyle = `rgb(${(138 * tone) | 0},${(92 * tone) | 0},${(46 * tone) | 0})`
      g.fillRect(0, y, s, 40)
      g.globalAlpha = 0.3
      g.strokeStyle = '#5f3d1c'
      for (let k = 0; k < 7; k++) {
        const yy = y + 4 + Math.random() * 34
        g.beginPath()
        g.moveTo(0, yy)
        g.bezierCurveTo(s * 0.3, yy + 3, s * 0.6, yy - 3, s, yy + 1)
        g.stroke()
      }
      g.globalAlpha = 1
      g.fillStyle = '#4e3115'
      g.fillRect(0, y + 39, s, 3)
    }
    speckle(g, s, 900, ['#7a4e24', '#9c6c3a', '#6b441f'], 0.4)
    // уголки и диагонали
    g.strokeStyle = '#3f2810'
    g.lineWidth = 14
    g.strokeRect(4, 4, s - 8, s - 8)
    g.lineWidth = 10
    g.beginPath()
    g.moveTo(0, 0); g.lineTo(s, s)
    g.moveTo(s, 0); g.lineTo(0, s)
    g.stroke()
    // трафарет
    g.save()
    g.translate(s / 2, s / 2)
    g.rotate(-0.06)
    g.font = '900 44px Rubik, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = 'rgba(230,220,190,0.85)'
    g.fillText('AMMO', 0, -8)
    g.font = '700 22px Rubik, sans-serif'
    g.fillStyle = 'rgba(120,40,30,0.8)'
    g.fillText('7.62×39', 0, 30)
    g.restore()
    // гвозди
    g.fillStyle = '#2c1c0a'
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14], [s / 2, s / 2]]) {
      g.beginPath()
      g.arc(x, y, 4, 0, 7)
      g.fill()
    }
  }, 1, 1)

  const containerTex = (base: string, logo: string) => canvasTex(256, (g, s) => {
    g.fillStyle = base
    g.fillRect(0, 0, s, s)
    // гофра
    for (let x = 0; x < s; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.32)'
      g.fillRect(x, 0, 6, s)
      g.fillStyle = 'rgba(255,255,255,0.12)'
      g.fillRect(x + 8, 0, 3, s)
    }
    speckle(g, s, 1400, ['rgba(0,0,0,.4)', 'rgba(255,255,255,.12)'], 0.35)
    // ржавые потёки
    g.globalAlpha = 0.22
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * s
      g.fillStyle = '#6e3418'
      g.fillRect(x, Math.random() * s * 0.4, 3 + Math.random() * 6, 30 + Math.random() * 80)
    }
    g.globalAlpha = 1
    // логотип
    g.font = '900 46px Rubik, sans-serif'
    g.textAlign = 'center'
    g.fillStyle = 'rgba(240,235,220,0.9)'
    g.fillText(logo, s / 2, s / 2 + 14)
    g.strokeStyle = 'rgba(240,235,220,0.5)'
    g.lineWidth = 3
    g.strokeRect(24, s / 2 - 40, s - 48, 86)
    // рама
    g.strokeStyle = 'rgba(0,0,0,0.55)'
    g.lineWidth = 12
    g.strokeRect(2, 2, s - 4, s - 4)
  }, 2, 1)

  const barrelTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#7a3a2a'
    g.fillRect(0, 0, s, s)
    speckle(g, s, 700, ['rgba(0,0,0,.4)', 'rgba(255,255,255,.1)'], 0.4)
    // обручи
    g.fillStyle = 'rgba(0,0,0,0.5)'
    g.fillRect(0, 10, s, 7)
    g.fillRect(0, s - 17, s, 7)
    // опасная полоса
    g.save()
    g.fillStyle = '#d8b23a'
    g.fillRect(0, s / 2 - 16, s, 32)
    g.beginPath()
    g.rect(0, s / 2 - 16, s, 32)
    g.clip()
    g.fillStyle = '#171310'
    for (let x = -32; x < s + 32; x += 32) {
      g.beginPath()
      g.moveTo(x, s / 2 + 16)
      g.lineTo(x + 16, s / 2 - 16)
      g.lineTo(x + 32, s / 2 - 16)
      g.lineTo(x + 16, s / 2 + 16)
      g.fill()
    }
    g.restore()
    g.font = '900 20px Rubik, sans-serif'
    g.textAlign = 'center'
    g.fillStyle = 'rgba(240,230,210,0.85)'
    g.fillText('FUEL', s / 2, s / 2 - 26)
  }, 2, 1)

  const matGround = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 })
  const matWall = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95 })
  const matCrate = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 })
  const matRust = new THREE.MeshStandardMaterial({ map: containerTex('#9c4f28', 'MIRAGE'), roughness: 0.7, metalness: 0.3 })
  const matOlive = new THREE.MeshStandardMaterial({ map: containerTex('#57613c', 'DUST'), roughness: 0.7, metalness: 0.3 })
  const matBarrel = new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.65, metalness: 0.35 })
  const matSandbag = new THREE.MeshStandardMaterial({ color: 0xb3a06f, roughness: 1 })

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
    solids.push(m)
    if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h / 2 })
    return m
  }

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), matGround)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  solids.push(ground)

  // perimeter walls
  addBox(42, 5, 1, 0, 2.5, -20.5, matWall)
  addBox(42, 5, 1, 0, 2.5, 20.5, matWall)
  addBox(1, 5, 42, -20.5, 2.5, 0, matWall)
  addBox(1, 5, 42, 20.5, 2.5, 0, matWall)

  // mid structures
  addBox(10, 3, 0.9, -6, 1.5, -2, matWall)
  addBox(0.9, 3, 9, 7, 1.5, 4, matWall)
  addBox(7, 3, 0.9, 12, 1.5, -8, matWall)
  addBox(0.9, 3, 7, -13, 1.5, 7, matWall)

  // shipping containers (запрыгнуть можно со стоящего рядом ящика)
  addBox(6.4, 2.9, 2.7, -12, 1.45, -9, matRust)
  addBox(6.4, 2.9, 2.7, 12, 1.45, 10, matOlive)

  // crates
  const crate = (x: number, z: number, stack = 1) => {
    addBox(1.4, 1.4, 1.4, x, 0.7, z, matCrate)
    if (stack > 1) addBox(1.4, 1.4, 1.4, x, 2.1, z, matCrate)
  }
  crate(-3, 13, 2)
  crate(4.2, 9)
  crate(-14, -4)
  crate(14, -13, 2)
  crate(0.5, -6)
  crate(9.5, 2)
  crate(-8.5, 2.5)
  crate(16.5, 5)
  crate(-16.5, 13)
  crate(6, -15)
  crate(-5, -13)
  crate(10.8, 8.6)   // ступенька к контейнеру

  // barrels
  const barrel = (x: number, z: number) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.15, 16), matBarrel)
    b.position.set(x, 0.575, z)
    b.castShadow = true
    b.receiveShadow = true
    scene.add(b)
    solids.push(b)
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, top: 1.15 })
  }
  barrel(-1.6, -11); barrel(-0.6, -11.4); barrel(10.5, 15); barrel(-10.5, 15.5); barrel(2.5, 1.5)

  // sandbag walls (низкие — перешагиваются автоматически)
  addBox(2.6, 0.85, 0.8, -7, 0.42, 9, matSandbag)
  addBox(2.6, 0.85, 0.8, 9, 0.42, -2.5, matSandbag)
  addBox(0.8, 0.85, 2.6, -2, 0.42, 5.5, matSandbag)

  // scattered pebbles
  const pebGeo = new THREE.BoxGeometry(0.09, 0.05, 0.09)
  const pebMat = new THREE.MeshStandardMaterial({ color: 0x9b8a63, roughness: 1 })
  for (let i = 0; i < 130; i++) {
    const p = new THREE.Mesh(pebGeo, pebMat)
    p.position.set((Math.random() - 0.5) * 38, 0.02, (Math.random() - 0.5) * 38)
    p.rotation.y = Math.random() * Math.PI
    const s = 0.5 + Math.random() * 1.6
    p.scale.set(s, 0.4 + Math.random(), s)
    p.receiveShadow = true
    scene.add(p)
  }

  // sun disc + glow sprite
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(6, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false })
  )
  sun.position.set(-38, 34, -52)
  sun.lookAt(0, 0, 0)
  scene.add(sun)
  const glowCv = document.createElement('canvas')
  glowCv.width = glowCv.height = 128
  const gg = glowCv.getContext('2d')!
  const grad = gg.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,240,200,0.9)')
  grad.addColorStop(0.4, 'rgba(255,210,140,0.35)')
  grad.addColorStop(1, 'rgba(255,190,120,0)')
  gg.fillStyle = grad
  gg.fillRect(0, 0, 128, 128)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glowCv), color: 0xffe6b8, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }))
  glow.position.set(-38, 34, -51)
  glow.scale.set(30, 30, 1)
  scene.add(glow)

  // drifting dust motes
  const dustGeo = new THREE.BufferGeometry()
  const dustPos = new Float32Array(220 * 3)
  for (let i = 0; i < 220; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 38
    dustPos[i * 3 + 1] = Math.random() * 6
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 38
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff0c8, size: 0.05, transparent: true, opacity: 0.5 }))
  dust.name = 'dust'
  scene.add(dust)

  return {
    solids,
    colliders,
    bounds: { minX: -19.4, maxX: 19.4, minZ: -19.4, maxZ: 19.4, top: 5 },
    botSpawns: [
      { x: -15, z: -15 }, { x: -6, z: -17 }, { x: 6, z: -17 }, { x: 15, z: -15 },
      { x: -17, z: -3 }, { x: 17, z: -3 }, { x: -10, z: -9 }, { x: 10, z: -9 },
      { x: -17, z: 12 }, { x: 17, z: 13 },
    ],
    playerSpawn: { x: 0, z: 16 },
  }
}
