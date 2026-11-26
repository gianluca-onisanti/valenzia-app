/**
 * Importa o mundo do formato antigo (arquivos em public/) para o banco.
 *
 * Os arquivos antigos sairam do repositorio; para recupera-los do historico:
 *
 *   mkdir ../legado && git archive 9cf12b1 public | tar -x -C ../legado
 *   npm run import:legacy -- ../legado/public --radius 9557
 *
 * O terreno vem, nesta ordem, de data/land.png (a costa editada), de
 * mask.png + data/geo.json (saidas do antigo `prepare:map`, que nunca foram
 * versionadas) ou, na falta deles, da imagem em source/, passada pela mesma
 * extracao que a interface usa. Junto vem world.json, territory.png e
 * biome.png. O corpo nasce com dois materiais: 0 = mar, 1 = terra. As
 * camadas de territorio e bioma passam como estao -- o formato do pixel
 * (R + G*256) nao mudou.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import {
  EARTH_RADIUS_KM,
  isUuid,
  type BiomeArea,
  type Poi,
  withIce,
  type Territory,
} from '@valenzia/shared'
import { createDb } from '../db/client'
import { bodies } from '../db/schema'
import { createBody } from '../bodies/repo'
import { decodeLayerPng, encodeLayerPng } from '../terrain/codec'
import { LAND_CODE, WATER_CODE, extractTerrain, terrainFromExtraction } from '../terrain/extract'
import { env } from '../env'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

interface LegacyWorld {
  name?: string
  territories?: (Omit<Territory, 'id'> & { id?: string; capital?: string })[]
  biomes?: (Omit<BiomeArea, 'id'> & { id?: string })[]
  pois?: (Omit<Poi, 'id'> & { id?: string })[]
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function readTerrain(dir: string, width: number, height: number): Promise<Uint16Array> {
  const edited = path.join(dir, 'data', 'land.png')
  if (existsSync(edited)) {
    console.log('> Costa editada: data/land.png')
    const { layer, width: w, height: h } = await decodeLayerPng(await readFile(edited))
    if (w !== width || h !== height) throw new Error('land.png com tamanho diferente do geo.json')
    // land.png guarda 1 = terra, 0 = mar: os mesmos codigos do terreno novo.
    return layer.map((v) => (v === 1 ? LAND_CODE : WATER_CODE))
  }
  console.log('> Mascara do preparo: mask.png')
  const { data, info } = await sharp(await readFile(path.join(dir, 'mask.png')))
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== width || info.height !== height) {
    throw new Error('mask.png com tamanho diferente do geo.json')
  }
  const terrain = new Uint16Array(width * height)
  for (let i = 0; i < terrain.length; i++) {
    terrain[i] = data[i * info.channels] > 127 ? LAND_CODE : WATER_CODE
  }
  return terrain
}

async function readLayer(file: string, width: number, height: number): Promise<Buffer | undefined> {
  if (!existsSync(file)) return undefined
  const { layer, width: w, height: h } = await decodeLayerPng(await readFile(file))
  if (w !== width || h !== height) throw new Error(path.basename(file) + ' com tamanho errado')
  return encodeLayerPng(layer, width, height)
}

const blank = (v: string | undefined) => (v && v.trim() ? v : undefined)

interface Base {
  width: number
  height: number
  land: string
  water: string
  terrain: Uint16Array
}

/** O gabarito: dos arquivos do prepare, se existirem; senao, da imagem. */
async function readBase(dir: string): Promise<Base> {
  const geoFile = path.join(dir, 'data', 'geo.json')
  const hasMask = existsSync(path.join(dir, 'mask.png')) || existsSync(path.join(dir, 'data', 'land.png'))
  if (existsSync(geoFile) && hasMask) {
    const geo = JSON.parse(await readFile(geoFile, 'utf8')) as Omit<Base, 'terrain'>
    return { ...geo, terrain: await readTerrain(dir, geo.width, geo.height) }
  }
  const sourceDir = path.join(dir, 'source')
  const images = existsSync(sourceDir)
    ? (await readdir(sourceDir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    : []
  if (images.length === 0) {
    throw new Error(
      'Nao achei o gabarito em ' + dir + ' (nem mask.png + data/geo.json, nem imagem em source/). ' +
        'Veja no topo deste arquivo como recuperar os arquivos antigos do historico do git.',
    )
  }
  console.log('> Sem mask.png: extraindo terra e mar de source/' + images[0])
  const result = await extractTerrain(await readFile(path.join(sourceDir, images[0])))
  const { terrain } = terrainFromExtraction(result)
  return {
    width: result.width,
    height: result.height,
    land: result.landColor,
    water: result.waterColor,
    terrain,
  }
}

async function main() {
  const positional = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'))
  const dir = path.resolve(positional ?? path.join(ROOT, 'public'))
  const radiusKm = Number(arg('--radius') ?? Math.round(EARTH_RADIUS_KM * 1.5))
  const force = process.argv.includes('--force')

  console.log('> Lendo ' + dir)
  const geo = await readBase(dir)
  const worldFile = path.join(dir, 'data', 'world.json')
  const world: LegacyWorld = existsSync(worldFile)
    ? JSON.parse(await readFile(worldFile, 'utf8'))
    : {}
  const name = world.name ?? 'Valenzia'

  const { db, sql } = createDb(env.databaseUrl)
  try {
    const existing = await db.select({ id: bodies.id }).from(bodies).where(eq(bodies.name, name))
    if (existing.length && !force) {
      throw new Error(
        'Ja existe um corpo chamado "' + name + '" no banco. Use --force para importar de novo mesmo assim.',
      )
    }

    const terrain = geo.terrain
    const body = await createBody(db, {
      name,
      radiusKm,
      width: geo.width,
      height: geo.height,
      origin: 'image',
      materials: withIce([
        { code: WATER_CODE, name: 'Mar', phase: 'liquid', color: geo.water },
        { code: LAND_CODE, name: 'Terra', phase: 'solid', color: geo.land },
      ]),
      terrainPng: await encodeLayerPng(terrain, geo.width, geo.height),
      territoryPng: await readLayer(path.join(dir, 'data', 'territory.png'), geo.width, geo.height),
      biomePng: await readLayer(path.join(dir, 'data', 'biome.png'), geo.width, geo.height),
      // Os ids antigos eram slugs; agora sao uuids estaveis.
      territories: (world.territories ?? []).map((t) => ({
        id: isUuid(t.id) ? t.id : randomUUID(),
        slot: t.slot,
        name: t.name,
        kind: t.kind,
        color: t.color,
        governo: blank(t.governo),
        populacao: blank(t.populacao),
        descricao: blank(t.descricao),
        labelPos: t.labelPos,
      })),
      biomes: (world.biomes ?? []).map((b) => ({
        id: isUuid(b.id) ? b.id : randomUUID(),
        slot: b.slot,
        name: b.name,
        type: b.type,
        descricao: blank(b.descricao),
      })),
      pois: (world.pois ?? []).map((p) => ({
        id: isUuid(p.id) ? p.id : randomUUID(),
        name: p.name,
        type: p.type,
        x: p.x,
        y: p.y,
        descricao: blank(p.descricao),
      })),
    })
    console.log(
      '> Criado "' + body.name + '" (' + body.id + '): ' +
        body.territories.length + ' territorios, ' +
        body.biomes.length + ' biomas, ' +
        body.pois.length + ' pontos, raio ' + radiusKm + ' km',
    )
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('\nFalhou: ' + (err as Error).message)
  process.exit(1)
})
