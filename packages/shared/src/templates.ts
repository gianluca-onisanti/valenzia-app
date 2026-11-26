import type { Material, RingSpec } from './domain'
import type { TemplateId } from './schemas'

/**
 * Pontos de partida para um mapa em branco. Um modelo e so a lista inicial
 * de materiais e qual deles cobre o mapa inteiro; tudo continua editavel.
 */
export interface Template {
  id: TemplateId
  label: string
  hint: string
  materials: Material[]
  /** Codigo do material que preenche o mapa ao nascer. */
  fill: number
  /** Aneis de saida (editaveis depois). */
  rings?: RingSpec
  /** Inclinacao do eixo de saida, em graus. */
  axialTilt?: number
}

export const TEMPLATES: Record<TemplateId, Template> = {
  oceanico: {
    id: 'oceanico',
    label: 'Oceanico',
    hint: 'Tudo mar: desenhe os continentes por cima',
    fill: 0,
    materials: [
      {
        code: 0,
        name: 'Mar',
        phase: 'liquid',
        color: '#3f9fd0',
        texture: { pattern: 'ruido', color2: '#2a6f9e', intensity: 0.45, scale: 160 },
      },
      {
        code: 1,
        name: 'Terra',
        phase: 'solid',
        color: '#7fbf5a',
        texture: { pattern: 'ruido', color2: '#5e8f3e', intensity: 0.4, scale: 48 },
      },
    ],
  },
  rochoso: {
    id: 'rochoso',
    label: 'Rochoso',
    hint: 'Tudo rocha: abra lagos e desertos',
    fill: 1,
    materials: [
      { code: 0, name: 'Lago', phase: 'liquid', color: '#3f8fb5' },
      {
        code: 1,
        name: 'Rocha',
        phase: 'solid',
        color: '#a0745a',
        texture: { pattern: 'ruido', color2: '#6e4c3a', intensity: 0.55, scale: 40 },
      },
      {
        code: 2,
        name: 'Areia',
        phase: 'solid',
        color: '#d9b77a',
        texture: { pattern: 'ruido', intensity: 0.3, scale: 24 },
      },
    ],
  },
  gasoso: {
    id: 'gasoso',
    label: 'Gigante gasoso',
    hint: 'So gas, em faixas, com aneis: pinte as tempestades por cima',
    fill: 0,
    rings: { inner: 1.25, outer: 2.3, color: '#d8c49a', color2: '#9c8466', opacity: 0.8, seed: 7 },
    axialTilt: 27,
    materials: [
      {
        code: 0,
        name: 'Gas claro',
        phase: 'gas',
        color: '#e4c79a',
        texture: { pattern: 'faixas', color2: '#b07a52', intensity: 0.75, scale: 90 },
      },
      {
        code: 1,
        name: 'Tempestade',
        phase: 'gas',
        color: '#c4603f',
        texture: { pattern: 'ruido', color2: '#e8a070', intensity: 0.6, scale: 20 },
      },
    ],
  },
  lua: {
    id: 'lua',
    label: 'Lua cinzenta',
    hint: 'Regolito por toda parte',
    fill: 0,
    materials: [
      {
        code: 0,
        name: 'Regolito',
        phase: 'solid',
        color: '#9a9a96',
        texture: { pattern: 'crateras', intensity: 0.7, scale: 60 },
      },
      {
        code: 1,
        name: 'Mar lunar',
        phase: 'solid',
        color: '#5f5f5c',
        texture: { pattern: 'ruido', intensity: 0.35, scale: 50 },
      },
    ],
  },
}

export const TEMPLATE_LIST: Template[] = Object.values(TEMPLATES)
