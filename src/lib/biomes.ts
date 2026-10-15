import type { BiomeType } from '../types'

interface BiomeInfo {
  label: string
  color: string
}

export const BIOMES: Record<BiomeType, BiomeInfo> = {
  floresta: { label: 'Floresta', color: '#2f7a3e' },
  selva: { label: 'Selva', color: '#15603a' },
  deserto: { label: 'Deserto', color: '#e3c478' },
  pantano: { label: 'Pantano', color: '#5c6b3a' },
  montanha: { label: 'Montanha', color: '#8a8275' },
  colina: { label: 'Colina', color: '#a99a6d' },
  tundra: { label: 'Tundra', color: '#9fb3b8' },
  savana: { label: 'Savana', color: '#c7a94a' },
  geleira: { label: 'Geleira', color: '#dbeef5' },
  vulcanico: { label: 'Vulcanico', color: '#7a3b32' },
}

export const BIOME_TYPES = Object.keys(BIOMES) as BiomeType[]

/** Cores sugeridas para novos paises, giradas em ordem. */
export const COUNTRY_COLORS = [
  '#d9796f',
  '#6fa8d9',
  '#8bc46a',
  '#c79ad4',
  '#d9b65f',
  '#5fc2b0',
  '#d98fb4',
  '#9aa5b5',
  '#c98a5a',
  '#7fb37a',
  '#b07fd4',
  '#d4c77f',
]

export const SEA_COLORS = [
  '#4f8fb5',
  '#3f7fa5',
  '#5fa0c2',
  '#6f8fb0',
  '#4a7f9a',
]
