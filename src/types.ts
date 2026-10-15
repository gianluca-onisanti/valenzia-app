/** Uma entidade pintada na camada de territorio. */
export type EntityKind = 'country' | 'sea'

/**
 * Pais ou mar. O `slot` e o numero gravado em cada pixel da camada; o `id` e
 * so para o JSON. Separar os dois deixa renomear sem tocar na pintura.
 */
export interface Territory {
  slot: number
  id: string
  name: string
  kind: EntityKind
  color: string
  governo?: string
  populacao?: string
  descricao?: string
  /** Posicao do rotulo em coordenadas da imagem; sem isso, usa o centro. */
  labelPos?: [number, number]
}

export type BiomeType =
  | 'floresta'
  | 'selva'
  | 'deserto'
  | 'pantano'
  | 'montanha'
  | 'colina'
  | 'tundra'
  | 'savana'
  | 'geleira'
  | 'vulcanico'

/** Area de bioma pintada na segunda camada, por cima dos paises. */
export interface BiomeArea {
  slot: number
  id: string
  name: string
  type: BiomeType
  descricao?: string
}

export type PoiType =
  | 'capital'
  | 'cidade'
  | 'vila'
  | 'porto'
  | 'fortaleza'
  | 'ruina'
  | 'masmorra'
  | 'templo'
  | 'marco'

export interface Poi {
  id: string
  name: string
  type: PoiType
  /** Coordenadas em pixels da imagem do mapa. */
  x: number
  y: number
  descricao?: string
}

export interface World {
  name: string
  territories: Territory[]
  biomes: BiomeArea[]
  pois: Poi[]
}

/** Qual camada o pincel esta pintando. */
export type PaintLayer = 'territory' | 'biome'

export type Tool = 'move' | 'select' | 'bucket' | 'lasso' | 'brush' | 'eraser'

export interface Viewport {
  x: number
  y: number
  scale: number
}

export type Selection =
  | { kind: 'territory'; slot: number }
  | { kind: 'biome'; slot: number }
  | { kind: 'poi'; id: string }
  | null

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}
