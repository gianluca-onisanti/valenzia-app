import { isUuid, slug, type Material } from '@valenzia/shared'
import type { BiomeArea, Poi, Territory, World } from '../types'

export { slug }

const DB_NAME = 'valenzia'
const DB_STORE = 'rascunho'

export function newId(): string {
  return crypto.randomUUID()
}

/**
 * Confere e completa um world.json importado. Arquivos do formato antigo
 * tinham ids em texto ("novo-pais-2"); aqui eles viram uuids, e quem nao tem
 * materiais herda os do mapa aberto.
 */
export function normalizeWorld(raw: Partial<World>, fallbackMaterials: Material[]): World {
  const fix = <T extends { id?: string }>(items: T[] | undefined) =>
    (items ?? []).map((item) => ({ ...item, id: isUuid(item.id) ? item.id : newId() }))
  return {
    name: raw.name ?? 'Sem nome',
    materials: raw.materials?.length ? raw.materials : fallbackMaterials,
    territories: fix(raw.territories) as Territory[],
    biomes: fix(raw.biomes) as BiomeArea[],
    pois: fix(raw.pois) as Poi[],
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
export class LayerSizeError extends Error {
  constructor(w: number, h: number, expectedW: number, expectedH: number) {
    super('Camada com ' + w + 'x' + h + ', mas o mapa tem ' + expectedW + 'x' + expectedH)
  }
}

export async function decodeLayer(
  source: Blob | string,
  width: number,
  height: number,
): Promise<Uint16Array> {
  const bitmap = await loadBitmap(source)
  try {
    // Uma camada de outro tamanho (rascunho de antes de uma conversao, por
    // exemplo) seria colada esticada ou cortada, em silencio. Melhor recusar.
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new LayerSizeError(bitmap.width, bitmap.height, width, height)
    }
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

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export interface Draft {
  world: World
  terrain: Blob
  territory: Blob
  biome: Blob
  /** A revisao do servidor sobre a qual o rascunho foi feito. */
  baseRevision: number
  savedAt: number
}

const draftKey = (bodyId: string) => 'draft:' + bodyId

/**
 * Rascunho local, um por mapa: protege o trabalho se o navegador fechar sem
 * salvar. Guarda a revisao de origem para nunca atropelar, em silencio, uma
 * versao mais nova salva em outro lugar.
 */
export async function saveDraft(bodyId: string, draft: Omit<Draft, 'savedAt'>): Promise<void> {
  try {
    await idbPut(draftKey(bodyId), { ...draft, savedAt: Date.now() })
  } catch {
    // Sem IndexedDB o usuario ainda pode salvar manualmente.
  }
}

export async function readDraft(bodyId: string): Promise<Draft | null> {
  try {
    const draft = await idbGet<Draft>(draftKey(bodyId))
    // Rascunho do formato antigo (sem terreno) nao serve para o mapa novo.
    return draft && draft.terrain ? draft : null
  } catch {
    return null
  }
}

export async function clearDraft(bodyId: string): Promise<void> {
  try {
    await idbDelete(draftKey(bodyId))
  } catch {
    // ignorado
  }
}

/** Miniatura do mapa para o atlas: a textura reduzida a `width` px. */
export function thumbnailOf(source: HTMLCanvasElement, width = 512): Promise<Blob | null> {
  const height = Math.max(1, Math.round((width * source.height) / source.width))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
