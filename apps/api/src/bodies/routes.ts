import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { LAYER_KINDS, TEMPLATES, type LayerKind } from '@valenzia/shared'
import {
  createBlankSchema,
  createFromImageSchema,
  patchBodySchema,
  saveDocumentSchema,
} from '@valenzia/shared/schemas'
import type { Database } from '../db/client'
import { badRequest } from '../errors'
import { encodeLayerPng, filledLayer } from '../terrain/codec'
import { extractTerrain, terrainFromExtraction } from '../terrain/extract'
import {
  createBody,
  deleteBody,
  getDocument,
  getLayer,
  getThumbnail,
  listTree,
  patchBody,
  saveDocument,
} from './repo'

const idParams = z.object({ id: z.uuid() })
const layerParams = z.object({ id: z.uuid(), kind: z.enum(LAYER_KINDS as [LayerKind, ...LayerKind[]]) })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const first = result.error.issues[0]
    throw badRequest((first.path.length ? first.path.join('.') + ': ' : '') + first.message)
  }
  return result.data
}

/** Le um multipart inteiro: campos de texto e arquivos, todos em memoria. */
async function readMultipart(request: FastifyRequest) {
  const fields: Record<string, string> = {}
  const files: Record<string, Buffer> = {}
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      files[part.fieldname] = await part.toBuffer()
    } else {
      fields[part.fieldname] = String(part.value)
    }
  }
  return { fields, files }
}

/** As camadas mudam a cada Salvar: o navegador nunca deve guardar copia velha. */
const NO_STORE = 'no-store'

export async function bodyRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts

  app.get('/api/bodies', async () => listTree(db))

  app.get('/api/bodies/:id', async (request) => {
    const { id } = parse(idParams, request.params)
    return getDocument(db, id)
  })

  app.get('/api/bodies/:id/layers/:kind', async (request, reply) => {
    const { id, kind } = parse(layerParams, request.params)
    const png = await getLayer(db, id, kind)
    return reply.header('content-type', 'image/png').header('cache-control', NO_STORE).send(png)
  })

  app.get('/api/bodies/:id/thumbnail', async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const png = await getThumbnail(db, id)
    return reply.header('content-type', 'image/png').header('cache-control', NO_STORE).send(png)
  })

  /** Mapa em branco, a partir de um modelo. */
  app.post('/api/bodies', async (request, reply) => {
    const input = parse(createBlankSchema, request.body)
    const template = TEMPLATES[input.template]
    const terrainPng = await encodeLayerPng(
      filledLayer(input.width, input.height, template.fill),
      input.width,
      input.height,
    )
    const body = await createBody(db, {
      name: input.name,
      description: input.description,
      radiusKm: input.radiusKm,
      parentId: input.parentId,
      width: input.width,
      height: input.height,
      origin: 'blank',
      rings: template.rings,
      axialTilt: template.axialTilt,
      materials: template.materials,
      terrainPng,
    })
    return reply.code(201).send(body)
  })

  /**
   * Analisa uma imagem sem criar nada: devolve as cores detectadas e uma
   * previa da mascara, para o usuario conferir antes de confirmar.
   */
  app.post('/api/terrain/preview', async (request) => {
    const { files } = await readMultipart(request)
    if (!files.image) throw badRequest('Envie a imagem no campo "image"')
    const result = await extractTerrain(files.image)
    return {
      width: result.width,
      height: result.height,
      landColor: result.landColor,
      waterColor: result.waterColor,
      landRatio: result.landPixels / (result.width * result.height),
      resized: result.resized,
      preview: 'data:image/png;base64,' + (await result.previewPng()).toString('base64'),
    }
  })

  /** Mapa a partir de uma imagem: terra e mar viram a camada de terreno. */
  app.post('/api/bodies/from-image', async (request, reply) => {
    const { fields, files } = await readMultipart(request)
    if (!files.image) throw badRequest('Envie a imagem no campo "image"')
    const input = parse(createFromImageSchema, {
      ...fields,
      parentId: fields.parentId || null,
    })
    const result = await extractTerrain(files.image)
    const { terrain, materials } = terrainFromExtraction(result, {
      landColor: input.landColor,
      waterColor: input.waterColor,
    })
    const body = await createBody(db, {
      name: input.name,
      description: input.description,
      radiusKm: input.radiusKm,
      parentId: input.parentId,
      width: result.width,
      height: result.height,
      origin: 'image',
      materials,
      terrainPng: await encodeLayerPng(terrain, result.width, result.height),
    })
    return reply.code(201).send(body)
  })

  app.patch('/api/bodies/:id', async (request) => {
    const { id } = parse(idParams, request.params)
    return patchBody(db, id, parse(patchBodySchema, request.body))
  })

  app.delete('/api/bodies/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params)
    await deleteBody(db, id)
    return reply.code(204).send()
  })

  /**
   * O Salvar: multipart com `document` (JSON) e as camadas `terrain`,
   * `territory` e `biome` em PNG, mais a `thumbnail` opcional.
   */
  app.put('/api/bodies/:id/document', async (request) => {
    const { id } = parse(idParams, request.params)
    const { fields, files } = await readMultipart(request)
    if (!fields.document) throw badRequest('Falta o campo "document"')
    let json: unknown
    try {
      json = JSON.parse(fields.document)
    } catch {
      throw badRequest('O campo "document" nao e JSON valido')
    }
    const input = parse(saveDocumentSchema, json)
    for (const kind of LAYER_KINDS) {
      if (!files[kind]) throw badRequest('Falta a camada "' + kind + '"')
    }
    return saveDocument(db, id, input, {
      terrain: files.terrain,
      territory: files.territory,
      biome: files.biome,
      thumbnail: files.thumbnail,
    })
  })
}
