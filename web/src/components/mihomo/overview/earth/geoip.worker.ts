/// <reference lib="webworker" />

// Adapted from Zephyruso/zashboard v3.18.0 under the MIT License.
// Copyright 2024 Zephyruso. See /THIRD_PARTY_NOTICES.md.

import { Buffer } from 'buffer'
import type { CityResponse, Reader as MMDBReader } from 'mmdb-lib'
import {
  DBIP_CITY_URL,
  DBIP_CITY_VERSION,
  DBIP_STORED_BYTES,
  type EarthLocation,
  type GeoDatabaseError,
  type GeoWorkerRequest,
  type GeoWorkerResponse,
} from './types'

declare const self: DedicatedWorkerGlobalScope

if (!(globalThis as { Buffer?: unknown }).Buffer) {
  ;(globalThis as { Buffer?: unknown }).Buffer = Buffer
}

const DATABASE_NAME = 'zashboard-earth-geoip'
const DATABASE_STORE = 'city-database'
const DATABASE_KEY = `dbip-city-lite-${DBIP_CITY_VERSION}`
const STORAGE_HEADROOM = 16 * 1024 * 1024

interface CachedDatabase {
  blob: Blob
  version: string
  storedAt: number
}

class WorkerError extends Error {
  constructor(readonly code: GeoDatabaseError) {
    super(code)
  }
}

let reader: MMDBReader<CityResponse> | null = null
let downloadController: AbortController | null = null

const post = (message: GeoWorkerResponse) => self.postMessage(message)

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
        request.result.createObjectStore(DATABASE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const readCachedDatabase = async (): Promise<CachedDatabase | undefined> => {
  const database = await openDatabase()

  return new Promise<CachedDatabase | undefined>((resolve, reject) => {
    const request = database
      .transaction(DATABASE_STORE, 'readonly')
      .objectStore(DATABASE_STORE)
      .get(DATABASE_KEY)

    request.onsuccess = () => resolve(request.result as CachedDatabase | undefined)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

const writeCachedDatabase = async (value: CachedDatabase) => {
  const database = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite')
    const store = transaction.objectStore(DATABASE_STORE)

    store.clear()
    store.put(value, DATABASE_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

const deleteCachedDatabase = async () => {
  const database = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite')

    transaction.objectStore(DATABASE_STORE).delete(DATABASE_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }).finally(() => database.close())
}

const createReader = async (blob: Blob) => {
  const databaseBuffer = await blob.arrayBuffer()
  const { Reader } = await import('mmdb-lib')
  const nextReader = new Reader<CityResponse>(Buffer.from(databaseBuffer))

  if (!nextReader.metadata.databaseType || nextReader.metadata.nodeCount <= 0) {
    throw new WorkerError('invalid')
  }

  return nextReader
}

const init = async () => {
  post({ type: 'status', status: 'checking' })

  try {
    const cached = await readCachedDatabase()

    if (!cached || cached.version !== DBIP_CITY_VERSION) {
      post({ type: 'status', status: 'idle' })
      return
    }

    post({ type: 'status', status: 'loading-cache' })

    try {
      reader = await createReader(cached.blob)
      post({ type: 'status', status: 'ready' })
    } catch {
      reader = null
      await deleteCachedDatabase().catch(() => {})
      post({ type: 'status', status: 'idle', recoveredCorruptCache: true })
    }
  } catch {
    post({ type: 'status', status: 'error', error: 'storage' })
  }
}

const ensureStorageSpace = async () => {
  try {
    const estimate = await navigator.storage?.estimate()

    if (estimate?.quota != null && estimate.usage != null) {
      const available = estimate.quota - estimate.usage

      if (available < DBIP_STORED_BYTES + STORAGE_HEADROOM) {
        throw new WorkerError('space')
      }
    }
  } catch (error) {
    if (error instanceof WorkerError) throw error
    // Some embedded browsers expose StorageManager but reject estimate(). In
    // that case IndexedDB remains the authoritative quota check.
  }
}

const download = async () => {
  if (downloadController) return

  if (typeof DecompressionStream === 'undefined') {
    post({ type: 'status', status: 'error', error: 'unsupported' })
    return
  }

  try {
    await ensureStorageSpace()
  } catch (error) {
    post({
      type: 'status',
      status: 'error',
      error: error instanceof WorkerError ? error.code : 'space',
    })
    return
  }

  const controller = new AbortController()
  downloadController = controller
  reader = null
  post({ type: 'status', status: 'downloading', received: 0 })

  try {
    const response = await fetch(DBIP_CITY_URL, { signal: controller.signal })

    if (!response.ok || !response.body) {
      throw new WorkerError('network')
    }

    const total = Number(response.headers.get('content-length')) || undefined
    let received = 0
    const progressStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, streamController) {
        received += chunk.byteLength
        post({ type: 'status', status: 'downloading', received, total })
        streamController.enqueue(chunk)
      },
    })
    let decompressed: ReadableStream<Uint8Array>

    try {
      const decompressionStream = new DecompressionStream(
        'gzip',
      ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
      decompressed = response.body.pipeThrough(progressStream).pipeThrough(decompressionStream)
    } catch {
      throw new WorkerError('decompress')
    }

    let blob: Blob

    try {
      blob = await new Response(decompressed).blob()
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new WorkerError('decompress')
    }

    if (controller.signal.aborted) return

    const nextReader = await createReader(blob)

    try {
      await writeCachedDatabase({
        blob,
        version: DBIP_CITY_VERSION,
        storedAt: Date.now(),
      })
    } catch {
      throw new WorkerError('storage')
    }

    reader = nextReader
    post({ type: 'status', status: 'ready' })
  } catch (error) {
    if (controller.signal.aborted) {
      post({ type: 'status', status: 'idle' })
    } else {
      post({
        type: 'status',
        status: 'error',
        error: error instanceof WorkerError ? error.code : 'network',
      })
    }
  } finally {
    if (downloadController === controller) {
      downloadController = null
    }
  }
}

const localizedName = (names: unknown, locale: string) => {
  if (!names || typeof names !== 'object') return ''

  const values = names as Record<string, string | undefined>
  const language = locale.toLowerCase()

  if (language.startsWith('zh')) return values['zh-CN'] ?? values.zh ?? values.en ?? ''
  if (language.startsWith('ru')) return values.ru ?? values.en ?? ''
  return values[locale] ?? values[language.split('-')[0]] ?? values.en ?? ''
}

const lookup = (id: number, ips: string[], locale: string) => {
  const locations: Record<string, EarthLocation | null> = {}

  for (const ip of ips) {
    try {
      const match = reader?.get(ip)
      const latitude = match?.location?.latitude
      const longitude = match?.location?.longitude

      locations[ip] =
        latitude == null || longitude == null
          ? null
          : {
              ip,
              latitude,
              longitude,
              city: localizedName(match?.city?.names, locale),
              country: localizedName(match?.country?.names, locale),
            }
    } catch {
      locations[ip] = null
    }
  }

  post({ type: 'lookup', id, locations })
}

self.onmessage = ({ data }: MessageEvent<GeoWorkerRequest>) => {
  switch (data.type) {
    case 'init':
      void init()
      break
    case 'download':
      void download()
      break
    case 'cancel':
      downloadController?.abort()
      break
    case 'lookup':
      lookup(data.id, data.ips, data.locale)
      break
  }
}
