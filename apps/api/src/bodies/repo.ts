import { and, count, eq, sql } from 'drizzle-orm'
import {
  slug,
  type BiomeArea,
  type BodyDocument,
  type BodyMeta,
  type BodyOrigin,
  type BodySummary,
  type BodyTreeNode,
  type LayerKind,
  type Material,
  type PatchBodyInput,
  type Poi,
  type SaveDocumentInput,
  type Territory,
} from '@valenzia/shared'
import type { Database } from '../db/client'
import { biomeAreas, bodies, layers, materials, pois, territories } from '../db/schema'
import { badRequest, conflict, notFound } from '../errors'
import { decodeLayerPng, encodeLayerPng, pngInfo } from '../terrain/codec'
import { renderThumbnail } from '../terrain/thumbnail'

type BodyRow = typeof bodies.$inferSelect
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Tx

/* ------------------------------------------------------------ mapeamento */

function toMeta(row: BodyRow): BodyMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    radiusKm: row.radiusKm,
    width: row.width,
    height: row.height,
    origin: row.origin,
    parentId: row.parentId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Opcional no JSON em vez de `null`: o editor trata ausencia como vazio. */
function opt<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

/* --------------------------------------------------------------- leitura */

/** O atlas: planetas com as luas penduradas, sem nenhum byte de camada. */
export async function listTree(db: Database): Promise<BodyTreeNode[]> {
  const rows = await db
    .select({
      id: bodies.id,
      ownerId: bodies.ownerId,
      parentId: bodies.parentId,
      name: bodies.name,
      slug: bodies.slug,
      description: bodies.description,
      radiusKm: bodies.radiusKm,
      width: bodies.width,
      height: bodies.height,
      origin: bodies.origin,
      revision: bodies.revision,
      createdAt: bodies.createdAt,
      updatedAt: bodies.updatedAt,
      hasThumbnail: sql<boolean>`${bodies.thumbnail} is not null`,
    })
    .from(bodies)
    .orderBy(bodies.name)

  const territoryCounts = await db
    .select({ bodyId: territories.bodyId, n: count() })
    .from(territories)
    .groupBy(territories.bodyId)
  const poiCounts = await db
    .select({ bodyId: pois.bodyId, n: count() })
    .from(pois)
    .groupBy(pois.bodyId)
  const tCount = new Map(territoryCounts.map((r) => [r.bodyId, r.n]))
  const pCount = new Map(poiCounts.map((r) => [r.bodyId, r.n]))

  const summaries: BodySummary[] = rows.map((row) => ({
    ...toMeta({ ...row, thumbnail: null }),
    territoryCount: tCount.get(row.id) ?? 0,
    poiCount: pCount.get(row.id) ?? 0,
    hasThumbnail: row.hasThumbnail,
  }))

  const planets: BodyTreeNode[] = summaries
    .filter((b) => !b.parentId)
    .map((b) => ({ ...b, moons: [] }))
  const byId = new Map(planets.map((p) => [p.id, p]))
  for (const body of summaries) {
    if (!body.parentId) continue
    const parent = byId.get(body.parentId)
    // Pai inexistente nao deveria acontecer (set null na FK), mas se
    // acontecer, a lua aparece solta em vez de sumir do atlas.
    if (parent) parent.moons.push(body)
    else planets.push({ ...body, moons: [] })
  }
  return planets
}

async function requireBody(db: Executor, id: string): Promise<BodyRow> {
  const [row] = await db.select().from(bodies).where(eq(bodies.id, id))
  if (!row) throw notFound('Corpo')
  return row
}

export async function getDocument(db: Database, id: string): Promise<BodyDocument> {
  const row = await requireBody(db, id)
  const [mats, terrs, biomes, points] = await Promise.all([
    db.select().from(materials).where(eq(materials.bodyId, id)).orderBy(materials.sort, materials.code),
    db.select().from(territories).where(eq(territories.bodyId, id)).orderBy(territories.slot),
    db.select().from(biomeAreas).where(eq(biomeAreas.bodyId, id)).orderBy(biomeAreas.slot),
    db.select().from(pois).where(eq(pois.bodyId, id)).orderBy(pois.name),
  ])
  return {
    ...toMeta(row),
    materials: mats.map(
      (m): Material => ({
        code: m.code,
        name: m.name,
        phase: m.phase,
        color: m.color,
        texture: m.texture ?? null,
      }),
    ),
    territories: terrs.map(
      (t): Territory => ({
        id: t.id,
        slot: t.slot,
        name: t.name,
        kind: t.kind,
        color: t.color,
        governo: opt(t.governo),
        populacao: opt(t.populacao),
        descricao: opt(t.descricao),
        labelPos: t.labelX !== null && t.labelY !== null ? [t.labelX, t.labelY] : undefined,
      }),
    ),
    biomes: biomes.map(
      (b): BiomeArea => ({
        id: b.id,
        slot: b.slot,
        name: b.name,
        type: b.type as BiomeArea['type'],
        descricao: opt(b.descricao),
      }),
    ),
    pois: points.map(
      (p): Poi => ({
        id: p.id,
        name: p.name,
        type: p.type as Poi['type'],
        x: p.x,
        y: p.y,
        descricao: opt(p.descricao),
      }),
    ),
  }
}

export async function getLayer(db: Database, id: string, kind: LayerKind): Promise<Buffer> {
  const [row] = await db
    .select({ png: layers.png })
    .from(layers)
    .where(and(eq(layers.bodyId, id), eq(layers.kind, kind)))
  if (!row) throw notFound('Camada')
  return row.png
}

export async function getThumbnail(db: Database, id: string): Promise<Buffer> {
  const [row] = await db
    .select({ thumbnail: bodies.thumbnail })
    .from(bodies)
    .where(eq(bodies.id, id))
  if (!row?.thumbnail) throw notFound('Miniatura')
  return row.thumbnail
}

/* ------------------------------------------------------------ vinculos */

/**
 * As regras de lua: o pai tem de existir e ser planeta, ninguem orbita a si
 * mesmo, e um planeta que ja tem luas nao vira lua (seriam luas de lua).
 */
async function checkParent(db: Executor, bodyId: string | null, parentId: string): Promise<void> {
  if (bodyId === parentId) throw badRequest('Um corpo nao pode orbitar a si mesmo')
  const [parent] = await db
    .select({ id: bodies.id, parentId: bodies.parentId })
    .from(bodies)
    .where(eq(bodies.id, parentId))
  if (!parent) throw badRequest('O corpo escolhido para orbitar nao existe')
  if (parent.parentId) {
    throw conflict('Esse corpo ja e uma lua: luas nao podem ter luas')
  }
  if (bodyId) {
    const [moons] = await db
      .select({ n: count() })
      .from(bodies)
      .where(eq(bodies.parentId, bodyId))
    if ((moons?.n ?? 0) > 0) {
      throw conflict(
        'Este planeta tem luas. Desvincule as luas dele antes de faze-lo orbitar outro planeta',
      )
    }
  }
}

/* ------------------------------------------------------------- escrita */

export interface NewBody {
  name: string
  description?: string
  radiusKm: number
  parentId?: string | null
  width: number
  height: number
  origin: BodyOrigin
  materials: Material[]
  terrainPng: Buffer
  territoryPng?: Buffer
  biomePng?: Buffer
  territories?: Territory[]
  biomes?: BiomeArea[]
  pois?: Poi[]
}

async function checkLayerSize(png: Buffer, width: number, height: number, label: string) {
  const info = await pngInfo(png)
  if (info.width !== width || info.height !== height) {
    throw badRequest(
      'A camada ' + label + ' tem ' + info.width + 'x' + info.height +
        ', mas o mapa tem ' + width + 'x' + height,
    )
  }
}

async function upsertLayer(db: Executor, bodyId: string, kind: LayerKind, png: Buffer) {
  await db
    .insert(layers)
    .values({ bodyId, kind, png })
    .onConflictDoUpdate({
      target: [layers.bodyId, layers.kind],
      set: { png, updatedAt: new Date() },
    })
}

/** Troca o conteudo inteiro de um corpo: materiais, fichas e pontos. */
async function replaceContent(
  tx: Executor,
  bodyId: string,
  content: {
    materials: Material[]
    territories: Territory[]
    biomes: BiomeArea[]
    pois: Poi[]
  },
) {
  await tx.delete(materials).where(eq(materials.bodyId, bodyId))
  await tx.delete(territories).where(eq(territories.bodyId, bodyId))
  await tx.delete(biomeAreas).where(eq(biomeAreas.bodyId, bodyId))
  await tx.delete(pois).where(eq(pois.bodyId, bodyId))

  if (content.materials.length) {
    await tx.insert(materials).values(
      content.materials.map((m, i) => ({
        bodyId,
        code: m.code,
        name: m.name,
        phase: m.phase,
        color: m.color,
        texture: m.texture ?? null,
        sort: i,
      })),
    )
  }
  if (content.territories.length) {
    await tx.insert(territories).values(
      content.territories.map((t) => ({
        id: t.id,
        bodyId,
        slot: t.slot,
        slug: slug(t.name),
        name: t.name,
        kind: t.kind,
        color: t.color,
        governo: t.governo ?? null,
        populacao: t.populacao ?? null,
        descricao: t.descricao ?? null,
        labelX: t.labelPos?.[0] ?? null,
        labelY: t.labelPos?.[1] ?? null,
      })),
    )
  }
  if (content.biomes.length) {
    await tx.insert(biomeAreas).values(
      content.biomes.map((b) => ({
        id: b.id,
        bodyId,
        slot: b.slot,
        slug: slug(b.name),
        name: b.name,
        type: b.type,
        descricao: b.descricao ?? null,
      })),
    )
  }
  if (content.pois.length) {
    // Em lotes: um mundo cheio de pontos passaria do limite de parametros.
    for (let i = 0; i < content.pois.length; i += 2000) {
      await tx.insert(pois).values(
        content.pois.slice(i, i + 2000).map((p) => ({
          id: p.id,
          bodyId,
          slug: slug(p.name),
          name: p.name,
          type: p.type,
          x: p.x,
          y: p.y,
          descricao: p.descricao ?? null,
        })),
      )
    }
  }
}

export async function createBody(db: Database, input: NewBody): Promise<BodyDocument> {
  await checkLayerSize(input.terrainPng, input.width, input.height, 'de terreno')
  if (input.territoryPng) {
    await checkLayerSize(input.territoryPng, input.width, input.height, 'de territorio')
  }
  if (input.biomePng) await checkLayerSize(input.biomePng, input.width, input.height, 'de bioma')

  // Todo corpo nasce com as tres camadas (as que faltam, vazias) e com uma
  // miniatura, para o atlas ja mostrar previa.
  const empty = () => encodeLayerPng(new Uint16Array(input.width * input.height), input.width, input.height)
  const territoryPng = input.territoryPng ?? (await empty())
  const biomePng = input.biomePng ?? (await empty())
  const terrain = (await decodeLayerPng(input.terrainPng)).layer
  const territoryLayer = input.territories?.length
    ? (await decodeLayerPng(territoryPng)).layer
    : undefined
  const thumbnail = await renderThumbnail(
    terrain,
    input.width,
    input.height,
    input.materials,
    territoryLayer ? { layer: territoryLayer, entities: input.territories ?? [] } : undefined,
  )

  const id = await db.transaction(async (tx) => {
    if (input.parentId) await checkParent(tx, null, input.parentId)
    const [row] = await tx
      .insert(bodies)
      .values({
        name: input.name,
        slug: slug(input.name),
        description: input.description ?? '',
        radiusKm: input.radiusKm,
        parentId: input.parentId ?? null,
        width: input.width,
        height: input.height,
        origin: input.origin,
        thumbnail,
      })
      .returning({ id: bodies.id })
    await replaceContent(tx, row.id, {
      materials: input.materials,
      territories: input.territories ?? [],
      biomes: input.biomes ?? [],
      pois: input.pois ?? [],
    })
    await upsertLayer(tx, row.id, 'terrain', input.terrainPng)
    await upsertLayer(tx, row.id, 'territory', territoryPng)
    await upsertLayer(tx, row.id, 'biome', biomePng)
    return row.id
  })
  return getDocument(db, id)
}

export async function patchBody(
  db: Database,
  id: string,
  patch: PatchBodyInput,
): Promise<BodyDocument> {
  await db.transaction(async (tx) => {
    await requireBody(tx, id)
    if (patch.parentId) await checkParent(tx, id, patch.parentId)
    const set: Partial<typeof bodies.$inferInsert> = { updatedAt: new Date() }
    if (patch.name !== undefined) {
      set.name = patch.name
      set.slug = slug(patch.name)
    }
    if (patch.description !== undefined) set.description = patch.description
    if (patch.radiusKm !== undefined) set.radiusKm = patch.radiusKm
    if (patch.parentId !== undefined) set.parentId = patch.parentId
    await tx.update(bodies).set(set).where(eq(bodies.id, id))
  })
  return getDocument(db, id)
}

export async function deleteBody(db: Database, id: string): Promise<void> {
  const deleted = await db.delete(bodies).where(eq(bodies.id, id)).returning({ id: bodies.id })
  if (deleted.length === 0) throw notFound('Corpo')
}

export interface SaveFiles {
  terrain: Buffer
  territory: Buffer
  biome: Buffer
  thumbnail?: Buffer
}

/**
 * O Salvar do editor. Tudo numa transacao so: ou o mundo inteiro e as tres
 * camadas mudam juntos, ou nada muda. A revisao lida pelo editor tem de
 * bater com a do banco -- senao alguem salvou no meio, e sobrescrever
 * jogaria o trabalho dessa pessoa fora.
 */
export async function saveDocument(
  db: Database,
  id: string,
  input: SaveDocumentInput,
  files: SaveFiles,
): Promise<BodyDocument> {
  const body = await requireBody(db, id)
  await checkLayerSize(files.terrain, body.width, body.height, 'de terreno')
  await checkLayerSize(files.territory, body.width, body.height, 'de territorio')
  await checkLayerSize(files.biome, body.width, body.height, 'de bioma')
  if (files.thumbnail) await pngInfo(files.thumbnail)

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bodies)
      .set({
        name: input.name,
        slug: slug(input.name),
        revision: sql`${bodies.revision} + 1`,
        updatedAt: new Date(),
        ...(files.thumbnail ? { thumbnail: files.thumbnail } : {}),
      })
      .where(and(eq(bodies.id, id), eq(bodies.revision, input.expectedRevision)))
      .returning({ id: bodies.id })
    if (updated.length === 0) {
      throw conflict(
        'Este mapa foi salvo em outro lugar depois que voce o abriu. ' +
          'Recarregue para ver a versao nova (o seu rascunho fica guardado).',
      )
    }
    await replaceContent(tx, id, input as Parameters<typeof replaceContent>[2])
    await upsertLayer(tx, id, 'terrain', files.terrain)
    await upsertLayer(tx, id, 'territory', files.territory)
    await upsertLayer(tx, id, 'biome', files.biome)
  })
  return getDocument(db, id)
}
