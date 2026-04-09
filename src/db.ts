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
  fftData: number[]   // Float32Array from getFloatFrequencyData, 100-4000Hz bins
  recordedAt: number
  matchPct?: number   // only for type='comparison'
}

const DB_NAME = 'bestension'
const DB_VERSION = 1
const MAX_COMPARISONS_PER_RACKET = 20

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const racketStore = db.createObjectStore('rackets', { keyPath: 'id' })
        racketStore.createIndex('createdAt', 'createdAt')

        const soundStore = db.createObjectStore('sounds', { keyPath: 'id' })
        soundStore.createIndex('racketId', 'racketId')
        soundStore.createIndex('racketId_type', ['racketId', 'type'])
        soundStore.createIndex('recordedAt', 'recordedAt')
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
