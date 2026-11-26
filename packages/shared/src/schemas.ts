import { z } from 'zod'
import { BIOME_TYPES, MAX_MAP_HEIGHT, MAX_MAP_WIDTH, POI_TYPE_IDS } from './domain'

/**
 * Validacao do que entra pela API. O editor manda o mundo inteiro a cada
 * Salvar; o servidor nao confia em nada que veio do navegador.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #rrggbb')
const radius = z
  .number({ error: 'Informe o raio em km' })
  .positive('O raio tem de ser maior que zero')
  .max(1_000_000, 'Raio grande demais: o maximo e 1.000.000 km')
const bodyName = z.string().trim().min(1, 'De um nome ao corpo').max(120, 'Nome longo demais')
/** Slot e codigo cabem em 16 bits: e o que a camada guarda por pixel. */
const slot = z.number().int().min(1).max(65535)
const text = (max: number) => z.string().max(max)

export const textureSchema = z.object({
  pattern: z.enum(['liso', 'ruido', 'faixas', 'crateras']),
  color2: hexColor.optional(),
  intensity: z.number().min(0).max(1).optional(),
  scale: z.number().min(1).max(4096).optional(),
})

export const ringSchema = z
  .object({
    inner: z.number().min(1.02, 'O anel tem de comecar fora do planeta').max(8),
    outer: z.number().min(1.05).max(10, 'Anel largo demais (maximo 10x o raio)'),
    color: hexColor,
    color2: hexColor.optional(),
    opacity: z.number().min(0).max(1),
    seed: z.number().int().min(0).max(1_000_000),
  })
  .refine((r) => r.outer > r.inner + 0.02, 'A borda de fora tem de passar da de dentro')

export const materialSchema = z.object({
  code: z.number().int().min(0).max(65535),
  name: text(80).min(1),
  phase: z.enum(['solid', 'liquid', 'gas']),
  color: hexColor,
  texture: textureSchema.nullish(),
})

export const territorySchema = z.object({
  id: z.uuid(),
  slot,
  name: text(120).min(1),
  kind: z.enum(['country', 'sea', 'zone']),
  color: hexColor,
  governo: text(200).optional(),
  populacao: text(200).optional(),
  descricao: text(20000).optional(),
  labelPos: z.tuple([z.number(), z.number()]).optional(),
})

export const biomeSchema = z.object({
  id: z.uuid(),
  slot,
  name: text(120).min(1),
  type: z.enum(BIOME_TYPES as [string, ...string[]]),
  descricao: text(20000).optional(),
})

export const poiSchema = z.object({
  id: z.uuid(),
  name: text(120).min(1),
  type: z.enum(POI_TYPE_IDS as [string, ...string[]]),
  x: z.number().finite(),
  y: z.number().finite(),
  descricao: text(20000).optional(),
})

function uniqueBy<T>(key: (item: T) => unknown, label: string) {
  return (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<unknown>()
    for (const item of items) {
      const k = key(item)
      if (seen.has(k)) {
        ctx.addIssue({ code: 'custom', message: label + ' repetido: ' + String(k) })
        return
      }
      seen.add(k)
    }
  }
}

/** O corpo do Salvar: o conteudo inteiro de um corpo, mais a revisao lida. */
export const saveDocumentSchema = z.object({
  expectedRevision: z.number().int().min(0),
  name: text(120).min(1),
  materials: z
    .array(materialSchema)
    .min(1)
    .max(256)
    .superRefine(uniqueBy((m) => m.code, 'Codigo de material')),
  territories: z
    .array(territorySchema)
    .max(4000)
    .superRefine(uniqueBy((t) => t.slot, 'Slot de territorio')),
  biomes: z
    .array(biomeSchema)
    .max(4000)
    .superRefine(uniqueBy((b) => b.slot, 'Slot de bioma')),
  pois: z.array(poiSchema).max(20000),
})

export type SaveDocumentInput = z.infer<typeof saveDocumentSchema>

export const templateIds = ['oceanico', 'rochoso', 'gasoso', 'lua'] as const
export type TemplateId = (typeof templateIds)[number]

export const createBlankSchema = z.object({
  name: bodyName,
  description: text(20000).optional(),
  radiusKm: radius,
  parentId: z.uuid().nullish(),
  width: z.number().int().min(256).max(MAX_MAP_WIDTH, 'Largura maxima: ' + MAX_MAP_WIDTH + ' px'),
  height: z.number().int().min(128).max(MAX_MAP_HEIGHT, 'Altura maxima: ' + MAX_MAP_HEIGHT + ' px'),
  template: z.enum(templateIds),
})

export type CreateBlankInput = z.infer<typeof createBlankSchema>

export const patchBodySchema = z.object({
  name: bodyName.optional(),
  description: text(20000).optional(),
  radiusKm: radius.optional(),
  parentId: z.uuid().nullable().optional(),
  rings: ringSchema.nullable().optional(),
  axialTilt: z.number().min(0, 'Inclinacao de 0 a 180 graus').max(180, 'Inclinacao de 0 a 180 graus').optional(),
  retrograde: z.boolean().optional(),
})

export type PatchBodyInput = z.infer<typeof patchBodySchema>

/** Campos de texto do formulario de criacao a partir de imagem. */
export const createFromImageSchema = z.object({
  name: bodyName,
  description: text(20000).optional(),
  radiusKm: z.coerce.number().pipe(radius),
  parentId: z.uuid().nullish(),
  landColor: hexColor.optional(),
  waterColor: hexColor.optional(),
  /** Em que projecao a imagem foi desenhada. */
  projection: z.enum(['equirect', 'mercator']).default('equirect'),
  /** Com Mercator: o que preenche as calotas polares. */
  cap: z.enum(['water', 'ice']).default('ice'),
})

export type CreateFromImageInput = z.infer<typeof createFromImageSchema>

/** Converte um corpo desenhado em Mercator para o equirretangular do app. */
export const reprojectSchema = z.object({
  expectedRevision: z.number().int().min(0),
  /** 'copy' cria um corpo novo e deixa o original; 'replace' converte este. */
  mode: z.enum(['copy', 'replace']),
  /** O que preenche as calotas: um material do corpo ou um novo. */
  cap: z.union([
    z.object({ code: z.number().int().min(0).max(65535) }),
    z.object({
      material: z.object({
        name: z.string().trim().min(1).max(60),
        phase: z.enum(['solid', 'liquid', 'gas']),
        color: hexColor,
      }),
    }),
  ]),
  /** Nome da copia (padrao: "<nome> (Mercator)"). */
  name: bodyName.optional(),
})

export type ReprojectInput = z.infer<typeof reprojectSchema>

