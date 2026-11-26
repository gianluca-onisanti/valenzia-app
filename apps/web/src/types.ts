/**
 * Os tipos do mundo vem de @valenzia/shared, os mesmos que a API valida.
 * Aqui ficam so os que existem apenas no editor.
 */
export type {
  BiomeArea,
  BiomeType,
  BodyDocument,
  BodyMeta,
  BodySummary,
  BodyTreeNode,
  Material,
  Phase,
  Poi,
  PoiType,
  Territory,
  TerritoryKind,
  TextureSpec,
  WorldContent as World,
} from '@valenzia/shared'

/** Qual camada a ferramenta esta pintando. */
export type PaintLayer = 'territory' | 'biome' | 'terrain'

export type Tool = 'move' | 'select' | 'bucket' | 'lasso' | 'brush'

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
