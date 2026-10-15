import type { World } from '../types'

const BASE = import.meta.env.BASE_URL
const DB_NAME = 'valenzia'
const DB_STORE = 'rascunho'

export const EMPTY_WORLD: World = {
  name: 'Valenzia',
  territories: [],
  biomes: [],
  pois: [],
}

export function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'sem-nome'
  )
}

export function uniqueId(name: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  const base = slug(name)
  if (!set.has(base)) return base
  let n = 2
  while (set.has(base + '-' + n)) n++
  return base + '-' + n
}

export function normalizeWorld(raw: Partial<World>): World {
  return {
    name: raw.name ?? 'Valenzia',
    territories: raw.territories ?? [],
    biomes: raw.biomes ?? [],
    pois: raw.pois ?? [],
  }
}

/* ------------------------------------------------- camadas como imagem PNG */

/**
 * As camadas sao rasters de 7,7M de posicoes -- nao cabem em JSON. Viram PNG,
 * com o numero do slot distribuido em R + G*256. Sao poucos valores em areas
 * chapadas, entao o PNG comprime muito bem.
 */
export function encodeLayer(
  layer: Uint16Array,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador.')
  const image = ctx.createImageData(width, height)
  const out = image.data
  for (let i = 0; i < layer.length; i++) {
    const v = layer[i]
    const o = i * 4
    out[o] = v & 0xff
    out[o + 1] = (v >> 8) & 0xff
    out[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar PNG'))),
      'image/png',
    )
  })
}

/**
 * Le a camada de volta do PNG.
 *
 * Os dois cuidados aqui nao sao frescura: o valor do pixel e o numero do dono,
 * nao uma cor, entao qualquer ajuste de um bit que o navegador ache bonito
 * inventa um pais. A conversao para o perfil do monitor fica desligada, e o
 * canvas pedido como 'willReadFrequently' fica na CPU, longe do arredondamento
 * que a leitura de volta da GPU pode introduzir.
 */
export async function decodeLayer(
  source: Blob | string,
  width: number,
  height: number,
): Promise<Uint16Array> {
  const bitmap = await loadBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
      colorSpace: 'srgb',
    }) as CanvasRenderingContext2D | null
    if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador.')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, width, height, { colorSpace: 'srgb' })
    const layer = new Uint16Array(width * height)
    for (let i = 0; i < layer.length; i++) {
      layer[i] = data[i * 4] | (data[i * 4 + 1] << 8)
    }
    return layer
  } finally {
    if ('close' in bitmap) bitmap.close()
  }
}

async function loadBitmap(source: Blob | string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof source !== 'string' && typeof createImageBitmap === 'function') {
    return createImageBitmap(source, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    })
  }
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  if (typeof createImageBitmap === 'function') {
    const response = await fetch(url)
    const blob = await response.blob()
    try {
      return await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      })
    } finally {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
    }
  }
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Camada ilegivel'))
      el.src = url
    })
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}

/* --------------------------------------------------------------- IndexedDB */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const request = tx.objectStore(DB_STORE).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value
}

async function idbClear(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export interface Draft {
  world: World
  territory: Blob
  biome: Blob
  /** A costa editada. Ausente em rascunho antigo, feito antes dela existir. */
  land?: Blob
  savedAt: number
}

/** Rascunho local: protege o trabalho se o navegador fechar sem salvar. */
export async function saveDraft(
  world: World,
  territory: Blob,
  biome: Blob,
  land: Blob,
): Promise<void> {
  try {
    await idbPut('draft', { world, territory, biome, land, savedAt: Date.now() })
  } catch {
    // Sem IndexedDB o usuario ainda pode salvar no projeto manualmente.
  }
}

export async function readDraft(): Promise<Draft | null> {
  try {
    return (await idbGet<Draft>('draft')) ?? null
  } catch {
    return null
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await idbClear()
  } catch {
    // ignorado
  }
}

/* ------------------------------------------------------- salvar no projeto */

/**
 * O servidor de dev responde o index.html com status 200 para arquivo que nao
 * existe (fallback de SPA), entao checar `ok` nao basta: sem olhar o
 * content-type, um mundo ausente viraria um erro de parse disfarcado.
 */
export async function fetchWorld(): Promise<World | null> {
  try {
    const res = await fetch(BASE + 'data/world.json', { cache: 'no-store' })
    if (!res.ok) return null
    if (!res.headers.get('content-type')?.includes('json')) return null
    return normalizeWorld(await res.json())
  } catch {
    return null
  }
}

export async function fetchLayer(
  name: 'territory' | 'biome' | 'land',
  width: number,
  height: number,
): Promise<Uint16Array | null> {
  try {
    const res = await fetch(BASE + 'data/' + name + '.png', { cache: 'no-store' })
    if (!res.ok) return null
    if (!res.headers.get('content-type')?.includes('image')) return null
    return await decodeLayer(await res.blob(), width, height)
  } catch {
    return null
  }
}

/**
 * Grava mundo e camadas em public/data/ pelo servidor de dev, para que o
 * trabalho entre no git. Sem servidor (build estatico) devolve false e a UI
 * oferece o download.
 */
export async function saveToProject(
  world: World,
  territory: Blob,
  biome: Blob,
  land: Blob,
): Promise<boolean> {
  try {
    const put = (path: string, body: BodyInit, type: string) =>
      fetch(path, { method: 'POST', headers: { 'content-type': type }, body })
    const results = await Promise.all([
      put('/__api/world', JSON.stringify(world, null, 2), 'application/json'),
      put('/__api/layer/territory', territory, 'image/png'),
      put('/__api/layer/biome', biome, 'image/png'),
      put('/__api/layer/land', land, 'image/png'),
    ])
    return results.every((r) => r.ok)
  } catch {
    return false
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
