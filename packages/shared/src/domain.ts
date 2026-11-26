/**
 * O vocabulario do mundo, compartilhado entre o editor e a API.
 *
 * Um mapa e um corpo celeste: planeta ou lua. Cada corpo tem tres camadas
 * raster (terreno, territorio e bioma), cada uma guardando um numero por
 * pixel, e as fichas que dao nome a esses numeros.
 */

/* ------------------------------------------------------------- terreno */

/** Estado fisico de um material de terreno. */
export type Phase = 'solid' | 'liquid' | 'gas'

export const PHASES: readonly Phase[] = ['solid', 'liquid', 'gas']

/** Bit de cada fase, para estencis do tipo "so pinta em solido ou gas". */
export const PHASE_BIT: Record<Phase, number> = { solid: 1, liquid: 2, gas: 4 }

/** Indice de cada fase na tabela de consulta por codigo de material. */
export const PHASE_INDEX: Record<Phase, number> = { solid: 0, liquid: 1, gas: 2 }

export type TexturePattern = 'liso' | 'ruido' | 'faixas' | 'crateras'

export interface TextureSpec {
  pattern: TexturePattern
  /** Segunda cor do padrao; sem ela, o padrao so clareia e escurece. */
  color2?: string
  /** 0 a 1. */
  intensity?: number
  /** Tamanho do padrao, em pixels do mapa. */
  scale?: number
}

/**
 * Um material de terreno. O `code` e o numero gravado em cada pixel da
 * camada de terreno, como o `slot` dos paises.
 */
export interface Material {
  code: number
  name: string
  phase: Phase
  color: string
  texture?: TextureSpec | null
}

/* ----------------------------------------------------------- entidades */

/**
 * Que tipo de territorio, e em que fase de terreno ele pode ser pintado:
 * pais em solido, mar em liquido, zona em gas.
 */
export type TerritoryKind = 'country' | 'sea' | 'zone'

export const TERRITORY_PHASE: Record<TerritoryKind, Phase> = {
  country: 'solid',
  sea: 'liquid',
  zone: 'gas',
}

/**
 * Pais, mar ou zona. O `slot` e o numero gravado em cada pixel da camada de
 * territorio; o `id` e um uuid estavel, para outras partes do app poderem
 * apontar para ele. Separar os dois deixa renomear sem tocar na pintura.
 */
export interface Territory {
  id: string
  slot: number
  name: string
  kind: TerritoryKind
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

export const BIOME_TYPES: readonly BiomeType[] = [
  'floresta',
  'selva',
  'deserto',
  'pantano',
  'montanha',
  'colina',
  'tundra',
  'savana',
  'geleira',
  'vulcanico',
]

/** Area de bioma pintada na segunda camada, por cima dos paises. */
export interface BiomeArea {
  id: string
  slot: number
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

export const POI_TYPE_IDS: readonly PoiType[] = [
  'capital',
  'cidade',
  'vila',
  'porto',
  'fortaleza',
  'ruina',
  'masmorra',
  'templo',
  'marco',
]

export interface Poi {
  id: string
  name: string
  type: PoiType
  /** Coordenadas em pixels da imagem do mapa. */
  x: number
  y: number
  descricao?: string
}

/* -------------------------------------------------------------- corpos */

export type BodyOrigin = 'image' | 'blank'

/** As tres camadas raster de um corpo. */
export type LayerKind = 'terrain' | 'territory' | 'biome'

export const LAYER_KINDS: readonly LayerKind[] = ['terrain', 'territory', 'biome']

/**
 * Planeta ou lua nao e um campo: e quem tem `parentId` que e lua. Vincular
 * um planeta a outro ja o transforma em lua.
 */
export type BodyKind = 'planet' | 'moon'

export function bodyKindOf(body: { parentId: string | null }): BodyKind {
  return body.parentId ? 'moon' : 'planet'
}

/**
 * Aneis em volta do corpo, no plano do equador. Raios em multiplos do raio
 * do proprio corpo (Saturno: de ~1,2 a ~2,3). As faixas e falhas saem de
 * `seed`: o mesmo numero desenha sempre o mesmo anel.
 */
export interface RingSpec {
  inner: number
  outer: number
  color: string
  /** Cor da borda de fora; sem ela, o anel e de uma cor so. */
  color2?: string
  /** 0 a 1. */
  opacity: number
  seed: number
}

export interface BodyMeta {
  id: string
  name: string
  description: string
  radiusKm: number
  width: number
  height: number
  origin: BodyOrigin
  parentId: string | null
  rings: RingSpec | null
  /**
   * Inclinacao do eixo, em graus (0 a 180): Terra 23, Saturno 27, Urano 98.
   * No globo, tomba a esfera, os aneis e o plano das orbitas das luas.
   */
  axialTilt: number
  /**
   * Rotacao retrograda: o corpo gira no sentido contrario ao normal (como
   * Venus). No globo, inverte o sentido do giro automatico.
   */
  retrograde: boolean
  /**
   * Em que projecao o desenho original foi feito. O mapa guardado e sempre
   * equirretangular; 'mercator' marca um desenho ja convertido (ver
   * projection.ts), para ninguem converter duas vezes.
   */
  sourceProjection: 'equirect' | 'mercator'
  /** Sobe a cada Salvar; o editor manda a que leu para detectar conflito. */
  revision: number
  createdAt: string
  updatedAt: string
}

/** O conteudo editavel de um corpo: tudo que o Salvar grava. */
export interface WorldContent {
  name: string
  materials: Material[]
  territories: Territory[]
  biomes: BiomeArea[]
  pois: Poi[]
}

export interface BodyDocument extends BodyMeta {
  materials: Material[]
  territories: Territory[]
  biomes: BiomeArea[]
  pois: Poi[]
}

export interface BodySummary extends BodyMeta {
  territoryCount: number
  poiCount: number
  hasThumbnail: boolean
}

/** Um planeta e as luas que o orbitam, como a listagem do atlas devolve. */
export interface BodyTreeNode extends BodySummary {
  moons: BodySummary[]
}

/* ----------------------------------------------------------- medidas */

export const EARTH_RADIUS_KM = 6371

/** Maior lado aceito para um mapa: o navegador guarda 3 camadas em memoria. */
export const MAX_MAP_WIDTH = 4096
export const MAX_MAP_HEIGHT = 2048
