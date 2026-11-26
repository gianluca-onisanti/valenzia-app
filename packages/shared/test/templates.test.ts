import { describe, expect, it } from 'vitest'
import { TEMPLATES, iceCode, withIce } from '../src/templates'

describe('Gelo', () => {
  it('vem em todo modelo com superficie solida, e nao no gasoso', () => {
    expect(iceCode(TEMPLATES.oceanico.materials)).toBe(2)
    expect(iceCode(TEMPLATES.rochoso.materials)).toBe(3)
    expect(iceCode(TEMPLATES.lua.materials)).toBe(2)
    expect(iceCode(TEMPLATES.gasoso.materials)).toBeUndefined()
  })

  it('nao duplica e nao entra sem solido', () => {
    const once = withIce(TEMPLATES.oceanico.materials)
    expect(once).toBe(TEMPLATES.oceanico.materials)
    const gas = [{ code: 0, name: 'Gas', phase: 'gas' as const, color: '#ffffff' }]
    expect(withIce(gas)).toBe(gas)
  })
})
