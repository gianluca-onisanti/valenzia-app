import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { BodyDocument, BodyTreeNode } from '@valenzia/shared'
import { buildApp } from '../src/app'
import { createDb } from '../src/db/client'
import { runMigrations } from '../src/db/migrate'
import { encodeLayerPng, decodeLayerPng } from '../src/terrain/codec'

/**
 * Testes de ponta a ponta contra um Postgres de verdade (o do compose).
 * Usam um banco separado, zerado a cada execucao:
 *   TEST_DATABASE_URL=postgres://valenzia:valenzia@localhost:5442/valenzia_test
 */
const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://valenzia:valenzia@localhost:5442/valenzia_test'

let app: FastifyInstance
let base = ''
let close: () => Promise<void>
let available = true

beforeAll(async () => {
  try {
    await runMigrations(url)
  } catch (err) {
    available = false
    console.warn('Sem banco de teste, pulando os testes de API: ' + (err as Error).message)
    return
  }
  const { db, sql } = createDb(url)
  await sql`TRUNCATE bodies CASCADE`
  app = await buildApp({ db, maxUploadBytes: 30 * 1024 * 1024 })
  await app.listen({ port: 0, host: '127.0.0.1' })
  base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port
  close = async () => {
    await app.close()
    await sql.end()
  }
})

afterAll(async () => {
  if (close) await close()
})

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, init)
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function createBlank(name: string, extra: Record<string, unknown> = {}) {
  const res = await call<BodyDocument>(
    '/api/bodies',
    json('POST', { name, radiusKm: 6371, width: 256, height: 128, template: 'oceanico', ...extra }),
  )
  expect(res.status).toBe(201)
  return res.body
}

describe('API de corpos', () => {
  it('cria um mapa em branco com os materiais do modelo', async (ctx) => {
    if (!available) return ctx.skip()
    const body = await createBlank('Aqua')
    expect(body.revision).toBe(0)
    expect(body.parentId).toBeNull()
    expect(body.materials.map((m) => m.phase).sort()).toEqual(['liquid', 'solid', 'solid'])
    // Todo corpo solido nasce com Gelo, para as geleiras.
    expect(body.materials.find((m) => m.name === 'Gelo')).toMatchObject({ phase: 'solid', code: 2 })

    const res = await fetch(base + '/api/bodies/' + body.id + '/layers/terrain')
    expect(res.status).toBe(200)
    const { layer, width, height } = await decodeLayerPng(Buffer.from(await res.arrayBuffer()))
    expect([width, height]).toEqual([256, 128])
    expect(layer.every((v) => v === 0)).toBe(true) // oceanico: tudo mar (codigo 0)

    // Corpo novo ja nasce com territorio e bioma vazios, e com miniatura.
    const territory = await fetch(base + '/api/bodies/' + body.id + '/layers/territory')
    expect(territory.status).toBe(200)
    const empty = await decodeLayerPng(Buffer.from(await territory.arrayBuffer()))
    expect(empty.layer.every((v) => v === 0)).toBe(true)
    const thumb = await fetch(base + '/api/bodies/' + body.id + '/thumbnail')
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('content-type')).toBe('image/png')
  })

  it('salva e le de volta: camadas identicas, fichas e revisao nova', async (ctx) => {
    if (!available) return ctx.skip()
    const body = await createBlank('Terra Nova')
    const w = body.width
    const h = body.height
    const terrain = new Uint16Array(w * h)
    const territory = new Uint16Array(w * h)
    for (let i = 0; i < w * h; i++) {
      terrain[i] = i % w > w / 2 ? 1 : 0
      territory[i] = terrain[i] === 1 ? 300 : 0 // slot acima de 255
    }
    const territoryId = randomUUID()
    const form = new FormData()
    form.append(
      'document',
      JSON.stringify({
        expectedRevision: 0,
        name: 'Terra Nova',
        materials: body.materials,
        territories: [
          { id: territoryId, slot: 300, name: 'Reino', kind: 'country', color: '#aa3344', governo: 'Monarquia' },
        ],
        biomes: [],
        pois: [{ id: randomUUID(), name: 'Capital', type: 'capital', x: 200, y: 64 }],
      }),
    )
    form.append('terrain', new Blob([await encodeLayerPng(terrain, w, h)]), 'terrain.png')
    form.append('territory', new Blob([await encodeLayerPng(territory, w, h)]), 'territory.png')
    form.append('biome', new Blob([await encodeLayerPng(new Uint16Array(w * h), w, h)]), 'biome.png')
    const saved = await call<BodyDocument>('/api/bodies/' + body.id + '/document', {
      method: 'PUT',
      body: form,
    })
    expect(saved.status).toBe(200)
    expect(saved.body.revision).toBe(1)
    expect(saved.body.territories[0]).toMatchObject({ id: territoryId, slot: 300, governo: 'Monarquia' })
    expect(saved.body.pois).toHaveLength(1)

    const res = await fetch(base + '/api/bodies/' + body.id + '/layers/territory')
    const back = await decodeLayerPng(Buffer.from(await res.arrayBuffer()))
    expect(Array.from(back.layer)).toEqual(Array.from(territory))

    // Salvar de novo com a revisao velha: conflito, nada muda.
    const stale = new FormData()
    stale.append(
      'document',
      JSON.stringify({
        expectedRevision: 0,
        name: 'Atropelo',
        materials: body.materials,
        territories: [],
        biomes: [],
        pois: [],
      }),
    )
    for (const kind of ['terrain', 'territory', 'biome']) {
      stale.append(kind, new Blob([await encodeLayerPng(new Uint16Array(w * h), w, h)]), kind + '.png')
    }
    const conflict = await call<{ error: string }>('/api/bodies/' + body.id + '/document', {
      method: 'PUT',
      body: stale,
    })
    expect(conflict.status).toBe(409)
    const after = await call<BodyDocument>('/api/bodies/' + body.id)
    expect(after.body.name).toBe('Terra Nova')
    expect(after.body.revision).toBe(1)
  })

  it('recusa camada com tamanho diferente do mapa', async (ctx) => {
    if (!available) return ctx.skip()
    const body = await createBlank('Torto')
    const form = new FormData()
    form.append(
      'document',
      JSON.stringify({ expectedRevision: 0, name: 'Torto', materials: body.materials, territories: [], biomes: [], pois: [] }),
    )
    for (const kind of ['terrain', 'territory', 'biome']) {
      form.append(kind, new Blob([await encodeLayerPng(new Uint16Array(10 * 10), 10, 10)]), kind + '.png')
    }
    const res = await call<{ error: string }>('/api/bodies/' + body.id + '/document', {
      method: 'PUT',
      body: form,
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/10x10/)
  })

  it('aplica as regras de lua', async (ctx) => {
    if (!available) return ctx.skip()
    const planet = await createBlank('Gaia')
    const moon = await createBlank('Selene', { parentId: planet.id })
    expect(moon.parentId).toBe(planet.id)

    // Lua de lua: nao.
    const sub = await call<{ error: string }>(
      '/api/bodies',
      json('POST', { name: 'Sub', radiusKm: 10, width: 256, height: 128, template: 'lua', parentId: moon.id }),
    )
    expect(sub.status).toBe(409)

    // Orbitar a si mesmo: nao.
    const self = await call('/api/bodies/' + planet.id, json('PATCH', { parentId: planet.id }))
    expect(self.status).toBe(400)

    // Planeta com luas nao vira lua.
    const other = await createBlank('Cronos')
    const withMoons = await call('/api/bodies/' + planet.id, json('PATCH', { parentId: other.id }))
    expect(withMoons.status).toBe(409)

    // Planeta sem luas vincula e vira lua; o atlas mostra a arvore.
    const linked = await call<BodyDocument>('/api/bodies/' + other.id, json('PATCH', { parentId: planet.id }))
    expect(linked.status).toBe(200)
    const tree = await call<BodyTreeNode[]>('/api/bodies')
    const gaia = tree.body.find((b) => b.id === planet.id)!
    expect(gaia.moons.map((m) => m.name).sort()).toEqual(['Cronos', 'Selene'])
    expect(tree.body.find((b) => b.id === other.id)).toBeUndefined()

    // Excluir o planeta solta as luas, que viram planetas.
    const del = await fetch(base + '/api/bodies/' + planet.id, { method: 'DELETE' })
    expect(del.status).toBe(204)
    const after = await call<BodyTreeNode[]>('/api/bodies')
    expect(after.body.find((b) => b.id === moon.id)?.parentId).toBeNull()
  })

  it('cria a partir de imagem enviada', async (ctx) => {
    if (!available) return ctx.skip()
    const sharp = (await import('sharp')).default
    const w = 120
    const h = 60
    const raw = Buffer.alloc(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      const land = i % w > 60
      raw[i * 3] = land ? 0x83 : 0x5f
      raw[i * 3 + 1] = land ? 0xe6 : 0xdb
      raw[i * 3 + 2] = land ? 0x4b : 0xff
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()

    const previewForm = new FormData()
    previewForm.append('image', new Blob([png]), 'mapa.png')
    const preview = await call<{ landRatio: number; landColor: string }>('/api/terrain/preview', {
      method: 'POST',
      body: previewForm,
    })
    expect(preview.status).toBe(200)
    expect(preview.body.landColor).toBe('#83e64b')
    expect(preview.body.landRatio).toBeCloseTo(59 / 120, 2)

    const form = new FormData()
    form.append('name', 'Da Imagem')
    form.append('radiusKm', '3000')
    form.append('image', new Blob([png]), 'mapa.png')
    const created = await call<BodyDocument>('/api/bodies/from-image', { method: 'POST', body: form })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ width: w, height: h, origin: 'image', radiusKm: 3000 })
  })

  it('cria a partir de imagem em Mercator, com calota de gelo', async (ctx) => {
    if (!available) return ctx.skip()
    const sharp = (await import('sharp')).default
    const w = 120
    const h = 80
    const raw = Buffer.alloc(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      const land = i % w > 60
      raw[i * 3] = land ? 0x83 : 0x5f
      raw[i * 3 + 1] = land ? 0xe6 : 0xdb
      raw[i * 3 + 2] = land ? 0x4b : 0xff
    }
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
    const form = new FormData()
    form.append('name', 'Mercatoria')
    form.append('radiusKm', '3000')
    form.append('projection', 'mercator')
    form.append('cap', 'ice')
    form.append('image', new Blob([png]), 'mapa.png')
    const created = await call<BodyDocument>('/api/bodies/from-image', { method: 'POST', body: form })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ width: w, height: 60, sourceProjection: 'mercator' })
    expect(created.body.materials.map((m) => m.name)).toContain('Gelo')
    const res = await fetch(base + '/api/bodies/' + created.body.id + '/layers/terrain')
    const terrain = (await decodeLayerPng(Buffer.from(await res.arrayBuffer()))).layer
    // Linha do polo: toda calota (Gelo, codigo 2). Equador: mar e terra.
    expect(new Set(terrain.subarray(0, w))).toEqual(new Set([2]))
    expect(new Set(terrain.subarray(30 * w, 31 * w))).toEqual(new Set([0, 1]))
  })

  it('reprojeta de Mercator: copia e no lugar', async (ctx) => {
    if (!available) return ctx.skip()
    const body = await createBlank('Plano', { width: 320, height: 128 })
    const w = 320
    const h = 128
    // Terra encostando no topo do desenho, um pais nela e um ponto perto do topo.
    const terrain = new Uint16Array(w * h)
    const territory = new Uint16Array(w * h)
    for (let y = 0; y < 20; y++) for (let x = 0; x < w; x++) {
      terrain[y * w + x] = 1
      territory[y * w + x] = 1
    }
    const form = new FormData()
    form.append(
      'document',
      JSON.stringify({
        expectedRevision: 0,
        name: 'Plano',
        materials: body.materials,
        territories: [{ id: randomUUID(), slot: 1, name: 'Norte', kind: 'country', color: '#aa3344', labelPos: [100, 10] }],
        biomes: [],
        pois: [{ id: randomUUID(), name: 'Topo', type: 'cidade', x: 50, y: 10 }],
      }),
    )
    form.append('terrain', new Blob([await encodeLayerPng(terrain, w, h)]), 't.png')
    form.append('territory', new Blob([await encodeLayerPng(territory, w, h)]), 'p.png')
    form.append('biome', new Blob([await encodeLayerPng(new Uint16Array(w * h), w, h)]), 'b.png')
    const saved = await call<BodyDocument>('/api/bodies/' + body.id + '/document', { method: 'PUT', body: form })
    expect(saved.status).toBe(200)

    const cap = { material: { name: 'Gelo', phase: 'solid', color: '#e9f1f5' } }
    const copy = await call<BodyDocument>(
      '/api/bodies/' + body.id + '/reproject',
      json('POST', { expectedRevision: 1, mode: 'copy', cap }),
    )
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ name: 'Plano (Mercator)', width: 320, height: 160, sourceProjection: 'mercator' })
    expect(copy.body.id).not.toBe(body.id)
    // O corpo ja tinha Gelo: a calota usa ele, sem um segundo Gelo.
    expect(copy.body.materials.filter((m) => m.name === 'Gelo')).toHaveLength(1)
    expect(copy.body.pois[0].id).not.toBe(saved.body.pois[0].id)
    // O ponto desce em direcao ao equador e fica fora da calota.
    expect(copy.body.pois[0].y).toBeGreaterThan(10)
    const original = await call<BodyDocument>('/api/bodies/' + body.id)
    expect(original.body).toMatchObject({ height: 128, revision: 1, sourceProjection: 'equirect' })

    const stale = await call('/api/bodies/' + body.id + '/reproject', json('POST', { expectedRevision: 0, mode: 'replace', cap }))
    expect(stale.status).toBe(409)
    const badCap = await call('/api/bodies/' + body.id + '/reproject', json('POST', { expectedRevision: 1, mode: 'replace', cap: { code: 99 } }))
    expect(badCap.status).toBe(400)

    const replaced = await call<BodyDocument>(
      '/api/bodies/' + body.id + '/reproject',
      json('POST', { expectedRevision: 1, mode: 'replace', cap: { code: 0 } }),
    )
    expect(replaced.status).toBe(200)
    expect(replaced.body).toMatchObject({ height: 160, revision: 2, sourceProjection: 'mercator' })
    expect(replaced.body.territories[0].labelPos?.[1]).toBeGreaterThan(10)
    const res = await fetch(base + '/api/bodies/' + body.id + '/layers/territory')
    const back = await decodeLayerPng(Buffer.from(await res.arrayBuffer()))
    expect(back.height).toBe(160)
    // A calota (linha do polo) nao tem pais; logo abaixo dela, o pais continua.
    expect(back.layer[0]).toBe(0)
    const firstRow = Array.from({ length: 160 }, (_, y) => back.layer[y * w]).indexOf(1)
    expect(firstRow).toBeGreaterThan(0)

    const again = await call('/api/bodies/' + body.id + '/reproject', json('POST', { expectedRevision: 2, mode: 'replace', cap: { code: 0 } }))
    expect(again.status).toBe(409)
  })

  it('grava e valida aneis', async (ctx) => {
    if (!available) return ctx.skip()
    // O gigante gasoso ja nasce com aneis.
    const gas = await call<BodyDocument>(
      '/api/bodies',
      json('POST', { name: 'Anelado', radiusKm: 58000, width: 256, height: 128, template: 'gasoso' }),
    )
    expect(gas.body.rings).toMatchObject({ inner: 1.25, outer: 2.3 })

    const rings = { inner: 1.4, outer: 3, color: '#aabbcc', opacity: 0.6, seed: 42 }
    const ok = await call<BodyDocument>('/api/bodies/' + gas.body.id, json('PATCH', { rings }))
    expect(ok.status).toBe(200)
    expect(ok.body.rings).toEqual(rings)

    const inverted = await call<{ error: string }>(
      '/api/bodies/' + gas.body.id,
      json('PATCH', { rings: { ...rings, inner: 3, outer: 2 } }),
    )
    expect(inverted.status).toBe(400)
    const inside = await call('/api/bodies/' + gas.body.id, json('PATCH', { rings: { ...rings, inner: 0.5 } }))
    expect(inside.status).toBe(400)

    expect(gas.body.axialTilt).toBe(27)
    const tilted = await call<BodyDocument>('/api/bodies/' + gas.body.id, json('PATCH', { axialTilt: 98 }))
    expect(tilted.body.axialTilt).toBe(98)
    const tooMuch = await call('/api/bodies/' + gas.body.id, json('PATCH', { axialTilt: 200 }))
    expect(tooMuch.status).toBe(400)

    expect(gas.body.retrograde).toBe(false)
    const backwards = await call<BodyDocument>('/api/bodies/' + gas.body.id, json('PATCH', { retrograde: true }))
    expect(backwards.body.retrograde).toBe(true)
    const kept = await call<BodyDocument>('/api/bodies/' + gas.body.id, json('PATCH', { axialTilt: 10 }))
    expect(kept.body.retrograde).toBe(true)

    const off = await call<BodyDocument>('/api/bodies/' + gas.body.id, json('PATCH', { rings: null }))
    expect(off.body.rings).toBeNull()
    const tree = await call<BodyTreeNode[]>('/api/bodies')
    expect(tree.body.find((b) => b.id === gas.body.id)?.rings).toBeNull()
  })

  it('valida a entrada', async (ctx) => {
    if (!available) return ctx.skip()
    const bad = await call<{ error: string }>(
      '/api/bodies',
      json('POST', { name: '', radiusKm: -1, width: 99999, height: 10, template: 'x' }),
    )
    expect(bad.status).toBe(400)
    const missing = await call('/api/bodies/' + randomUUID())
    expect(missing.status).toBe(404)
    const notUuid = await call('/api/bodies/abc')
    expect(notUuid.status).toBe(400)
  })
})
