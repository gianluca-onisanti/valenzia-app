import { EARTH_RADIUS_KM } from './domain'

/**
 * Area real de cada pixel, por linha.
 *
 * O mapa e equirretangular: x e longitude, y e latitude, cobrindo a esfera
 * inteira. Todo pixel de uma mesma linha tem a mesma area, e ela encolhe
 * rumo aos polos. A faixa entre as latitudes phi1 e phi2 tem area
 * 2*pi*R^2*|sin(phi1) - sin(phi2)|; dividida pelas W colunas, da o pixel.
 *
 * Somando todas as linhas, o total e exatamente 4*pi*R^2.
 */
export function pixelAreaByRow(width: number, height: number, radiusKm: number): Float64Array {
  const out = new Float64Array(height)
  const perColumn = (2 * Math.PI * radiusKm * radiusKm) / width
  for (let y = 0; y < height; y++) {
    const top = Math.PI / 2 - (y / height) * Math.PI
    const bottom = Math.PI / 2 - ((y + 1) / height) * Math.PI
    out[y] = perColumn * Math.abs(Math.sin(top) - Math.sin(bottom))
  }
  return out
}

export function sphereAreaKm2(radiusKm: number): number {
  return 4 * Math.PI * radiusKm * radiusKm
}

/** "1,52x a Terra", pelo raio. */
export function earthRatio(radiusKm: number): number {
  return radiusKm / EARTH_RADIUS_KM
}

const KM2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const KM2_SHORT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** Area legivel: "512.300 km²" ou "148,9 mi km²". */
export function formatKm2(km2: number): string {
  if (km2 >= 1e6) return KM2_SHORT.format(km2 / 1e6) + ' mi km²'
  return KM2.format(km2) + ' km²'
}

export function formatKm(km: number): string {
  return KM2.format(km) + ' km'
}
