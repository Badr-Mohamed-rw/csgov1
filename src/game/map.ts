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

export function buildMap(scene: THREE.Scene): MapData {
  const solids: THREE.Mesh[] = []
  const colliders: AABB[] = []

  // --- textures ---
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
  }, 9, 9)

  const plasterTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#c9b58e'
    g.fillRect(0, 0, s, s)
    speckle(g, s, 1600, ['#b7a179', '#d8c69f', '#a38c64'], 0.4)
    g.globalAlpha = 0.22
    g.strokeStyle = '#8f7a55'
    for (let y = 0; y < s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke() }
    g.globalAlpha = 0.12
    for (let i = 0; i < 8; i++) {
      g.fillStyle = '#6e5b3d'
      g.fillRect(Math.random() * s, Math.random() * s, 30 + Math.random() * 60, 4 + Math.random() * 10)
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

  const metalTex = (base: string) => canvasTex(128, (g, s) => {
    g.fillStyle = base
    g.fillRect(0, 0, s, s)
    speckle(g, s, 700, ['rgba(0,0,0,.35)', 'rgba(255,255,255,.14)'], 0.4)
    g.strokeStyle = 'rgba(0,0,0,.4)'
    g.lineWidth = 4
    for (let x = 16; x < s; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke() }
    g.strokeStyle = 'rgba(255,255,255,.12)'
    g.strokeRect(3, 3, s - 6, s - 6)
  }, 2, 1)

  const matGround = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 })
  const matWall = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95 })
  const matCrate = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 })
  const matRust = new THREE.MeshStandardMaterial({ map: metalTex('#9c4f28'), roughness: 0.75, metalness: 0.25 })
  const matOlive = new THREE.MeshStandardMaterial({ map: metalTex('#57613c'), roughness: 0.75, metalness: 0.25 })
  const matBarrel = new THREE.MeshStandardMaterial({ map: metalTex('#7a3a2a'), roughness: 0.7, metalness: 0.3 })
  const matSandbag = new THREE.MeshStandardMaterial({ color: 0xb3a06f, roughness: 1 })

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
    solids.push(m)
    if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 })
    return m
  }

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), matGround)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  solids.push(ground)

  // perimeter walls (inner faces at ±20)
  addBox(42, 5, 1, 0, 2.5, -20.5, matWall)
  addBox(42, 5, 1, 0, 2.5, 20.5, matWall)
  addBox(1, 5, 42, -20.5, 2.5, 0, matWall)
  addBox(1, 5, 42, 20.5, 2.5, 0, matWall)

  // mid structures
  addBox(10, 3, 0.9, -6, 1.5, -2, matWall)
  addBox(0.9, 3, 9, 7, 1.5, 4, matWall)
  addBox(7, 3, 0.9, 12, 1.5, -8, matWall)
  addBox(0.9, 3, 7, -13, 1.5, 7, matWall)

  // shipping containers
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

  // barrels
  const barrel = (x: number, z: number) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.15, 14), matBarrel)
    b.position.set(x, 0.575, z)
    b.castShadow = true
    b.receiveShadow = true
    scene.add(b)
    solids.push(b)
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 })
  }
  barrel(-1.6, -11); barrel(-0.6, -11.4); barrel(10.5, 15); barrel(-10.5, 15.5); barrel(2.5, 1.5)

  // sandbag walls
  addBox(2.6, 0.85, 0.8, -7, 0.42, 9, matSandbag)
  addBox(2.6, 0.85, 0.8, 9, 0.42, -2.5, matSandbag)
  addBox(0.8, 0.85, 2.6, -2, 0.42, 5.5, matSandbag)

  // sun disc (decorative, outside fog reach)
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(6, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false })
  )
  sun.position.set(-38, 34, -52)
  sun.lookAt(0, 0, 0)
  scene.add(sun)

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
    bounds: { minX: -19.4, maxX: 19.4, minZ: -19.4, maxZ: 19.4 },
    botSpawns: [
      { x: -15, z: -15 }, { x: -6, z: -17 }, { x: 6, z: -17 }, { x: 15, z: -15 },
      { x: -17, z: -3 }, { x: 17, z: -3 }, { x: -10, z: -9 }, { x: 10, z: -9 },
      { x: -17, z: 12 }, { x: 17, z: 13 },
    ],
    playerSpawn: { x: 0, z: 16 },
  }
}
