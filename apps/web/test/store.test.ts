import { describe, expect, it } from 'vitest'
import type { Material } from '@valenzia/shared'
import { normalizeWorld } from '../src/lib/store'

const mar: Material = { code: 0, name: 'Mar', phase: 'liquid', color: '#0000ff' }
const terra: Material = { code: 1, name: 'Terra', phase: 'solid', color: '#00ff00' }
const gelo: Material = { code: 2, name: 'Gelo', phase: 'solid', color: '#ffffff' }

describe('rascunho e materiais do servidor', () => {
  it('junta o material que o servidor ganhou depois do rascunho', () => {
    const world = normalizeWorld({ materials: [mar, { ...terra, color: '#123456' }] }, [mar, terra, gelo])
    expect(world.materials.map((m) => m.name)).toEqual(['Mar', 'Terra', 'Gelo'])
    // O que o rascunho mudou continua valendo.
    expect(world.materials[1].color).toBe('#123456')
  })

  it('nao junta se o rascunho ja usa o codigo ou o nome', () => {
    const areia: Material = { code: 2, name: 'Areia', phase: 'solid', color: '#ccbb88' }
    expect(normalizeWorld({ materials: [mar, terra, areia] }, [mar, terra, gelo]).materials).toHaveLength(3)
    const outroGelo: Material = { ...gelo, code: 5 }
    expect(normalizeWorld({ materials: [mar, terra, outroGelo] }, [mar, terra, gelo]).materials).toHaveLength(3)
  })
})
