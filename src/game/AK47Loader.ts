import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const AK47_URL = 'https://raw.githubusercontent.com/Badr-Mohamed-rw/AK47/main/scene.gltf'

let cachedModel: THREE.Group | null = null
let loadingPromise: Promise<THREE.Group> | null = null

export async function loadAK47Model(): Promise<THREE.Group> {
  if (cachedModel) return cachedModel.clone()
  
  if (loadingPromise) return loadingPromise.then(m => m.clone())
  
  loadingPromise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    
    loader.load(
      AK47_URL,
      (gltf) => {
        const model = gltf.scene
        
        // Настройка масштаба и позиции
        model.scale.setScalar(0.08) // Подгоняем размер под игру
        model.rotation.set(0, Math.PI, 0) // Поворачиваем в правильную сторону
        
        // Настройка материалов
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
            
            // Улучшаем материалы
            if (child.material instanceof THREE.MeshStandardMaterial) {
              child.material.metalness = 0.7
              child.material.roughness = 0.4
              child.material.needsUpdate = true
            }
          }
        })
        
        cachedModel = model
        resolve(model)
      },
      (progress) => {
        // Прогресс загрузки (можно добавить UI индикатор)
        const percent = (progress.loaded / progress.total) * 100
        console.log(`AK47 loading: ${percent.toFixed(1)}%`)
      },
      (error) => {
        console.error('Failed to load AK47 model:', error)
        reject(error)
      }
    )
  })
  
  return loadingPromise.then(m => m.clone())
}

// Предзагрузка модели при старте
export function preloadAK47() {
  loadAK47Model().catch(err => {
    console.warn('AK47 preload failed:', err)
  })
}
