import * as THREE from 'three'

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number }

export interface MapData {
  solids: THREE.Mesh[]
  colliders: AABB[]
  bounds: AABB
  botSpawns: { x: number; z: number }[]
  playerSpawn: { x: number; z: number }
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, rx = 1, ry = 1) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  draw(g, size)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
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

export function collideMove(pos: THREE.Vector3, dx: number, dz: number, r: number, cols: AABB[], bounds?: AABB) {
  let nx = pos.x + dx
  for (const c of cols) {
    if (nx + r > c.minX && nx - r < c.maxX && pos.z + r > c.minZ && pos.z - r < c.maxZ) {
      if (dx > 0) nx = Math.min(nx, c.minX - r)
      else if (dx < 0) nx = Math.max(nx, c.maxX + r)
    }
  }
  pos.x = nx
  let nz = pos.z + dz
  for (const c of cols) {
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

/* Упрощённая схема Dust II:
   юг — спавн T, три выхода: туннели B (запад), мид (центр), лонг A (восток).
   мид с двойными дверями ведёт в CT-спавн, из него проходы на обе точки.   */
export function buildMap(scene: THREE.Scene): MapData {
  const solids: THREE.Mesh[] = []
  const colliders: AABB[] = []

  // ---------- textures ----------
  const sandTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c2a878'
    g.fillRect(0, 0, s, s)
    speckle(g, s, 2600, ['#b09463', '#d4bc8c', '#a8895a', '#cbb283'], 0.5)
    g.globalAlpha = 0.16
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#8f7448' : '#dcc596'
      g.beginPath()
      g.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 46, 12 + Math.random() * 30, Math.random() * 3, 0, 7)
      g.fill()
    }
    g.globalAlpha = 1
  }, 10, 10)

  const plasterTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c9b088'
    g.fillRect(0, 0, s, s)
    speckle(g, s, 1600, ['#b79d73', '#d8c39a', '#a3895f'], 0.42)
    g.globalAlpha = 0.22
    g.strokeStyle = '#8f7a55'
    for (let y = 0; y < s; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke() }
    g.globalAlpha = 0.14
    for (let i = 0; i < 9; i++) {
      g.fillStyle = '#6e5b3d'
      g.fillRect(Math.random() * s, Math.random() * s, 30 + Math.random() * 70, 4 + Math.random() * 12)
    }
    g.globalAlpha = 1
  }, 4, 2)

  const crateTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#8a5c2e'
    g.fillRect(0, 0, s, s)
    g.strokeStyle = '#5f3d1c'
    g.lineWidth = 5
    for (let y = 0; y <= s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke() }
    speckle(g, s, 500, ['#7a4e24', '#9c6c3a', '#6b441f'], 0.5)
    g.lineWidth = 8
    g.strokeStyle = '#4e3115'
    g.strokeRect(2, 2, s - 4, s - 4)
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s)
    g.lineWidth = 6; g.stroke()
  }, 1, 1)

  const doorTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#4c7a4f'
    g.fillRect(0, 0, s, s)
    speckle(g, s, 500, ['#3d6340', '#5c8a5e', '#2f4f33'], 0.5)
    g.strokeStyle = '#2f4f33'
    g.lineWidth = 8
    g.strokeRect(6, 6, s - 12, s - 12)
    g.fillStyle = '#2f4f33'
    g.fillRect(12, s * 0.42, s - 24, 10)
    g.fillStyle = '#d8c39a'
    g.fillRect(s - 26, s * 0.5, 8, 8)
  }, 1, 1)

  const matGround = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 })
  const matWall = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95 })
  const matCrate = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 })
  const matDoor = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.8, metalness: 0.15 })
  const matSandbag = new THREE.MeshStandardMaterial({ color: 0xb3a06f, roughness: 1 })
  const matPlanter = new THREE.MeshStandardMaterial({ color: 0x5d7a45, roughness: 0.95 })
  const matRoof = new THREE.MeshStandardMaterial({ color: 0x8d7a5c, roughness: 1 })
  const matBarrel = new THREE.MeshStandardMaterial({ color: 0x7a3a2a, roughness: 0.75, metalness: 0.25 })

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, opts?: { collide?: boolean; solid?: boolean }) => {
    const collide = opts?.collide !== false
    const solid = opts?.solid !== false
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
    if (solid) solids.push(m)
    if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 })
    return m
  }

  const barrel = (x: number, z: number) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.15, 14), matBarrel)
    b.position.set(x, 0.575, z)
    b.castShadow = true
    b.receiveShadow = true
    scene.add(b)
    solids.push(b)
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 })
  }

  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), matGround)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  solids.push(ground)

  // ---------- perimeter ----------
  addBox(42, 5, 1, 0, 2.5, -20.5, matWall)
  addBox(42, 5, 1, 0, 2.5, 20.5, matWall)
  addBox(1, 5, 42, -20.5, 2.5, 0, matWall)
  addBox(1, 5, 42, 20.5, 2.5, 0, matWall)

  // ---------- T spawn (south) north wall: gaps to B-tunnels / mid ----------
  addBox(12, 3.6, 0.8, -9, 1.8, 13, matWall)      // x -15..-3
  addBox(11, 3.6, 0.8, 8.5, 1.8, 13, matWall)     // x 3..14

  // ---------- mid corridor walls (x -3..3, z -6..13) ----------
  addBox(0.8, 3.6, 19, -3.4, 1.8, 3.5, matWall)
  addBox(0.8, 3.6, 19, 3.4, 1.8, 3.5, matWall)

  // ---------- CT spawn (x -7..7, z -16..-6) ----------
  addBox(0.8, 3.6, 1, -7.4, 1.8, -15.5, matWall)
  addBox(0.8, 3.6, 5, -7.4, 1.8, -8.5, matWall)   // opening z -15..-11 → B
  addBox(0.8, 3.6, 1, 7.4, 1.8, -15.5, matWall)
  addBox(0.8, 3.6, 5, 7.4, 1.8, -8.5, matWall)    // opening z -15..-11 → A
  addBox(14, 3.6, 0.8, 0, 1.8, -16.4, matWall)

  // ---------- site walls ----------
  addBox(8, 3.6, 0.8, -11, 1.8, -11.6, matWall)   // B site south (tunnel exit x -19.5..-15)
  addBox(7, 3.6, 0.8, 10.5, 1.8, -11.6, matWall)  // A site south (long opening x 14..19.5)

  // ---------- long A west wall (x 14..19.5 corridor) ----------
  addBox(0.8, 3.6, 26, 13.6, 1.8, 2, matWall)     // z -11..15, entry from T z 15..19.5

  // ---------- B tunnels east wall ----------
  addBox(0.8, 3.6, 25, -14.6, 1.8, 0.5, matWall)  // z -12..13

  // ---------- roofs (no collision) ----------
  addBox(5.6, 0.5, 16, -17.1, 3.55, -4, matRoof, { collide: false })   // B tunnels
  addBox(5.4, 0.5, 7.4, -17, 3.55, -15.7, matRoof, { collide: false }) // B site west overhang

  // ---------- dust2 landmarks ----------
  // mid double doors
  addBox(1.5, 2.8, 0.5, -1.5, 1.4, 2, matDoor)
  addBox(1.5, 2.8, 0.5, 1.5, 1.4, 2, matDoor)
  // long double doors (щель между створками — для пика, обход справа)
  addBox(1.8, 2.8, 0.5, 15.5, 1.4, 2, matDoor)
  addBox(1.8, 2.8, 0.5, 18.0, 1.4, 2, matDoor)
  // «Xbox» crate in mid
  addBox(1.4, 1.4, 1.4, 0, 0.7, 8.5, matCrate)

  // crates
  addBox(1.4, 1.4, 1.4, -8, 0.7, 16.5, matCrate)
  addBox(1.4, 1.4, 1.4, 6, 0.7, 17, matCrate)
  addBox(1.4, 1.4, 1.4, 16.5, 0.7, 9, matCrate)
  addBox(1.4, 1.4, 1.4, -3.5, 0.7, -13, matCrate)
  addBox(1.4, 1.4, 1.4, 3.5, 0.7, -13.5, matCrate)
  addBox(1.4, 1.4, 1.4, 16, 0.7, -17, matCrate)
  addBox(1.4, 1.4, 1.4, 16, 2.1, -17, matCrate)
  addBox(1.4, 1.4, 1.4, 12, 0.7, -18, matCrate)
  addBox(1.4, 1.4, 1.4, -9, 0.7, -13.5, matCrate)
  addBox(1.4, 1.4, 1.4, -17, 0.7, -18, matCrate)
  addBox(1.4, 1.4, 1.4, 15, 0.7, -5, matCrate)

  // goose (A site low platform)
  addBox(2.2, 0.9, 2.2, 9.5, 0.45, -13, matSandbag)

  // B site planter
  addBox(2.4, 1.0, 2.4, -13, 0.5, -16, matPlanter)

  // sandbags
  addBox(2.4, 0.85, 0.8, 0, 0.42, -4, matSandbag)
  addBox(2.4, 0.85, 0.8, 15.5, 0.42, -7.5, matSandbag)
  addBox(0.8, 0.85, 2.4, -11, 0.42, -12.6, matSandbag)
  addBox(2.4, 0.85, 0.8, -11.5, 0.42, 17.5, matSandbag)

  // barrels
  barrel(-12, 17.5)
  barrel(11, 15.5)
  barrel(-16.5, 8)
  barrel(-17, -6)
  barrel(18.5, 13)

  // ---------- site markers «A» / «B» ----------
  const letterTex = (letter: string, color: string) => canvasTex(128, (g, s) => {
    g.clearRect(0, 0, s, s)
    g.fillStyle = color
    g.font = 'bold 104px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(letter, s / 2, s / 2 + 6)
  }, 1, 1)
  const plateA = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: letterTex('A', '#f2a33c'), transparent: true }))
  plateA.position.set(19.96, 2.4, -15)
  plateA.rotation.y = -Math.PI / 2
  scene.add(plateA)
  solids.push(plateA)
  const plateB = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: letterTex('B', '#6fb7e8'), transparent: true }))
  plateB.position.set(-19.96, 2.4, -15)
  plateB.rotation.y = Math.PI / 2
  scene.add(plateB)
  solids.push(plateB)

  // ---------- atmosphere ----------
  const tunnelLamp1 = new THREE.PointLight(0xffb46b, 5, 11, 2)
  tunnelLamp1.position.set(-17, 2.9, -4)
  scene.add(tunnelLamp1)
  const tunnelLamp2 = new THREE.PointLight(0xffb46b, 3.2, 9, 2)
  tunnelLamp2.position.set(-17, 2.9, 8)
  scene.add(tunnelLamp2)
  const siteLamp = new THREE.PointLight(0xffd9a0, 3.4, 10, 2)
  siteLamp.position.set(-14, 3, -15)
  scene.add(siteLamp)

  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false }))
  sun.position.set(-38, 34, -52)
  sun.lookAt(0, 0, 0)
  scene.add(sun)

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

  // ---------- небо, облака, пальмы, знаки сайтов ----------
  const skyCv = document.createElement('canvas')
  skyCv.width = 16
  skyCv.height = 256
  const sg = skyCv.getContext('2d')!
  const grad = sg.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#4e8cc4')
  grad.addColorStop(0.45, '#9cc3dd')
  grad.addColorStop(0.75, '#d8e3e4')
  grad.addColorStop(1, '#e6d9b8')
  sg.fillStyle = grad
  sg.fillRect(0, 0, 16, 256)
  const skyTex = new THREE.CanvasTexture(skyCv)
  skyTex.colorSpace = THREE.SRGBColorSpace
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  )
  scene.add(sky)

  const cloudCv = document.createElement('canvas')
  cloudCv.width = cloudCv.height = 128
  const cg = cloudCv.getContext('2d')!
  const rg = cg.createRadialGradient(64, 64, 8, 64, 64, 62)
  rg.addColorStop(0, 'rgba(255,255,255,0.95)')
  rg.addColorStop(0.6, 'rgba(255,255,255,0.45)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  cg.fillStyle = rg
  cg.fillRect(0, 0, 128, 128)
  const cloudTex = new THREE.CanvasTexture(cloudCv)
  const clouds = new THREE.Group()
  clouds.name = 'clouds'
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.7, fog: false, depthWrite: false }))
    const a = (i / 6) * Math.PI * 2 + Math.random()
    sp.position.set(Math.cos(a) * (70 + Math.random() * 40), 34 + Math.random() * 18, Math.sin(a) * (70 + Math.random() * 40))
    const s = 26 + Math.random() * 22
    sp.scale.set(s, s * 0.45, 1)
    clouds.add(sp)
  }
  scene.add(clouds)

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6844, roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5f7d3a, roughness: 0.9, side: THREE.DoubleSide })
  const palm = (x: number, z: number, h: number) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.27, h, 7), trunkMat)
    t.position.y = h / 2
    t.rotation.z = (Math.random() - 0.5) * 0.14
    t.castShadow = true
    g.add(t)
    for (let i = 0; i < 6; i++) {
      const pivot = new THREE.Object3D()
      pivot.position.y = h
      pivot.rotation.y = (i / 6) * Math.PI * 2 + Math.random() * 0.4
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 5), leafMat)
      leaf.scale.set(0.38, 1, 1)
      leaf.position.set(1.15, 0.2, 0)
      leaf.rotation.z = -1.75 - Math.random() * 0.25
      leaf.castShadow = true
      pivot.add(leaf)
      g.add(pivot)
    }
    scene.add(g)
    colliders.push({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28 })
  }
  palm(-14, 13, 5.2)
  palm(15.5, -13.5, 6)
  palm(-12.5, -13.5, 4.6)
  palm(10, 13.5, 5.6)

  const signTex = (letter: string) => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const g2 = cv.getContext('2d')!
    g2.fillStyle = '#1c2228'
    g2.fillRect(0, 0, 128, 128)
    g2.strokeStyle = '#f2a33c'
    g2.lineWidth = 8
    g2.strokeRect(8, 8, 112, 112)
    g2.fillStyle = '#f2e9d8'
    g2.font = 'bold 84px sans-serif'
    g2.textAlign = 'center'
    g2.textBaseline = 'middle'
    g2.fillText(letter, 64, 70)
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const signA = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: signTex('A') }))
  signA.position.set(-7, 3.4, -15.4)
  scene.add(signA)
  const signB = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: signTex('B') }))
  signB.position.set(15.4, 3.4, -2)
  signB.rotation.y = -Math.PI / 2
  scene.add(signB)

  return {
    solids,
    colliders,
    bounds: { minX: -19.4, maxX: 19.4, minZ: -19.4, maxZ: 19.4 },
    botSpawns: [
      { x: -12, z: -14 }, { x: -17.5, z: -13 }, { x: -17, z: 7 }, { x: -16.8, z: -7 },
      { x: -3, z: -13 }, { x: 3, z: -13 }, { x: 0, z: -14.8 },
      { x: 12, z: -14 }, { x: 16.5, z: -13 }, { x: 10, z: -17 },
      { x: 16.5, z: 7 }, { x: 15.5, z: -4.5 }, { x: 0, z: 7 },
    ],
    playerSpawn: { x: 2, z: 17 },
  }
}
