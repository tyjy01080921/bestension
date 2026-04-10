import { openDB, type IDBPDatabase } from 'idb'

export interface Racket {
  id: string
  name: string
  stringName?: string
  tension?: number
  unit: 'lbs' | 'kg'
  createdAt: number
}

export interface SoundProfile {
  id: string
  racketId: string
  type: 'best' | 'comparison'
  fftData: number[]   // 400-800Hz narrowband bins (DB v2: ~103개 빈, 3.9Hz/bin)
  recordedAt: number
  matchPct?: number   // 코사인 유사도 % (지각적 일치)
  tensionPct?: number // 스펙트럴 센트로이드 기반 텐션 유지율 % (물리적)
}

const DB_NAME = 'bestension'
const DB_VERSION = 2
const MAX_COMPARISONS_PER_RACKET = 20

// DB v2 기준 FFT 파라미터 (저장된 fftData에서 센트로이드 역산 시 사용)
const STORED_OFFLINE_SAMPLE_RATE = 8000
const STORED_FFT_SIZE = 2048
const STORED_HZ_PER_BIN = STORED_OFFLINE_SAMPLE_RATE / STORED_FFT_SIZE  // 3.906 Hz/bin
const STORED_BIN_START = Math.round(400 / STORED_HZ_PER_BIN)            // ≈ 102

/**
 * 저장된 narrowband fftData로부터 스펙트럴 센트로이드(Hz)를 계산합니다.
 * 센트로이드 = 400-800Hz 에너지의 무게중심 → 피크보다 노이즈에 강하고
 * 귀가 인식하는 평균 음정에 더 가깝습니다.
 */
export function centroidHzFromFft(fftData: number[]): number {
  let weightedSum = 0
  let totalWeight = 0
  for (let i = 0; i < fftData.length; i++) {
    const freq = (STORED_BIN_START + i) * STORED_HZ_PER_BIN
    weightedSum += freq * fftData[i]
    totalWeight += fftData[i]
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const racketStore = db.createObjectStore('rackets', { keyPath: 'id' })
          racketStore.createIndex('createdAt', 'createdAt')

          const soundStore = db.createObjectStore('sounds', { keyPath: 'id' })
          soundStore.createIndex('racketId', 'racketId')
          soundStore.createIndex('racketId_type', ['racketId', 'type'])
          soundStore.createIndex('recordedAt', 'recordedAt')
        }
        if (oldVersion < 2) {
          // v1의 fftData(100-4000Hz, 363빈)는 v2(400-800Hz, 103빈)와 호환 불가
          // rackets는 보존, sounds만 초기화
          transaction.objectStore('sounds').clear()
        }
      },
    })
  }
  return dbPromise
}

// ── Racket CRUD ────────────────────────────────────────────────────────────────

export async function saveRacket(racket: Racket): Promise<void> {
  const db = await getDB()
  await db.put('rackets', racket)
}

export async function getRackets(): Promise<Racket[]> {
  const db = await getDB()
  const all = await db.getAll('rackets')
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getRacket(id: string): Promise<Racket | undefined> {
  const db = await getDB()
  return db.get('rackets', id)
}

export async function deleteRacket(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['rackets', 'sounds'], 'readwrite')
  await tx.objectStore('rackets').delete(id)
  // delete all associated sounds
  const sounds = await tx.objectStore('sounds').index('racketId').getAll(id)
  for (const s of sounds) {
    await tx.objectStore('sounds').delete(s.id)
  }
  await tx.done
}

// ── SoundProfile CRUD ──────────────────────────────────────────────────────────

export async function saveBestSound(profile: SoundProfile): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('sounds', 'readwrite')
  const store = tx.objectStore('sounds')

  // demote existing best to comparison
  const existing = await store.index('racketId_type').getAll([profile.racketId, 'best'])
  for (const s of existing) {
    await store.put({ ...s, type: 'comparison' })
  }

  await store.put(profile)
  await tx.done
}

export async function saveComparisonSound(profile: SoundProfile): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('sounds', 'readwrite')
  const store = tx.objectStore('sounds')

  await store.put(profile)

  // enforce cap: keep only last MAX_COMPARISONS_PER_RACKET comparisons
  const all = await store.index('racketId_type').getAll([profile.racketId, 'comparison'])
  all.sort((a, b) => a.recordedAt - b.recordedAt)
  while (all.length > MAX_COMPARISONS_PER_RACKET) {
    const oldest = all.shift()!
    await store.delete(oldest.id)
  }

  await tx.done
}

export async function getBestSound(racketId: string): Promise<SoundProfile | undefined> {
  const db = await getDB()
  const results = await db.getAllFromIndex('sounds', 'racketId_type', [racketId, 'best'])
  return results[0]
}

export async function getComparisonHistory(racketId: string): Promise<SoundProfile[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('sounds', 'racketId_type', [racketId, 'comparison'])
  return all.sort((a, b) => b.recordedAt - a.recordedAt)
}

export async function deleteSound(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('sounds', id)
}

export async function clearAllData(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['rackets', 'sounds'], 'readwrite')
  await tx.objectStore('rackets').clear()
  await tx.objectStore('sounds').clear()
  await tx.done
}
