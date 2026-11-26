import {
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import type { RingSpec, TextureSpec } from '@valenzia/shared'

/** PNG e outros binarios. O driver postgres-js ja devolve Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const bodyOrigin = pgEnum('body_origin', ['image', 'blank'])
export const phase = pgEnum('material_phase', ['solid', 'liquid', 'gas'])
export const layerKind = pgEnum('layer_kind', ['terrain', 'territory', 'biome'])
export const territoryKind = pgEnum('territory_kind', ['country', 'sea', 'zone'])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/**
 * Um corpo celeste: cada mapa do atlas. Planeta ou lua nao e coluna -- quem
 * tem `parent_id` e lua. O vinculo so tem um nivel; a API garante.
 */
export const bodies = pgTable(
  'bodies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Dono, quando houver login. Nulo por enquanto: o app e de um usuario so. */
    ownerId: uuid('owner_id'),
    parentId: uuid('parent_id').references((): AnyPgColumn => bodies.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    radiusKm: doublePrecision('radius_km').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    origin: bodyOrigin('origin').notNull(),
    /** Aneis no plano do equador; nulo = sem aneis. */
    rings: jsonb('rings').$type<RingSpec | null>(),
    /** Inclinacao do eixo, em graus. */
    axialTilt: doublePrecision('axial_tilt').notNull().default(0),
    thumbnail: bytea('thumbnail'),
    revision: integer('revision').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('bodies_parent_idx').on(t.parentId), index('bodies_owner_idx').on(t.ownerId)],
)

/** Os materiais de terreno de um corpo. `code` e o valor gravado no pixel. */
export const materials = pgTable(
  'materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bodyId: uuid('body_id')
      .notNull()
      .references(() => bodies.id, { onDelete: 'cascade' }),
    code: smallint('code').notNull(),
    name: text('name').notNull(),
    phase: phase('phase').notNull(),
    color: text('color').notNull(),
    texture: jsonb('texture').$type<TextureSpec | null>(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [unique('materials_body_code').on(t.bodyId, t.code)],
)

/**
 * As tres camadas raster, como PNG: o numero do slot/codigo em R + G*256.
 * Ficam fora de `bodies` para a listagem do atlas nao arrastar megabytes.
 */
export const layers = pgTable(
  'layers',
  {
    bodyId: uuid('body_id')
      .notNull()
      .references(() => bodies.id, { onDelete: 'cascade' }),
    kind: layerKind('kind').notNull(),
    png: bytea('png').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bodyId, t.kind] })],
)

export const territories = pgTable(
  'territories',
  {
    id: uuid('id').primaryKey(),
    bodyId: uuid('body_id')
      .notNull()
      .references(() => bodies.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: territoryKind('kind').notNull(),
    color: text('color').notNull(),
    governo: text('governo'),
    populacao: text('populacao'),
    descricao: text('descricao'),
    labelX: real('label_x'),
    labelY: real('label_y'),
  },
  (t) => [unique('territories_body_slot').on(t.bodyId, t.slot)],
)

export const biomeAreas = pgTable(
  'biome_areas',
  {
    id: uuid('id').primaryKey(),
    bodyId: uuid('body_id')
      .notNull()
      .references(() => bodies.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    descricao: text('descricao'),
  },
  (t) => [unique('biome_areas_body_slot').on(t.bodyId, t.slot)],
)

export const pois = pgTable(
  'pois',
  {
    id: uuid('id').primaryKey(),
    bodyId: uuid('body_id')
      .notNull()
      .references(() => bodies.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    descricao: text('descricao'),
  },
  (t) => [index('pois_body_idx').on(t.bodyId)],
)
