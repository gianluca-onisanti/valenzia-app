/**
 * O mapa enrolado numa esfera.
 *
 * O desenho ja esta em projecao equiretangular -- x e longitude, y e latitude
 * -- entao nao falta nada para virar globo: basta ler o mapa de tras para
 * frente. Para cada pixel do disco na tela, a gente descobre que ponto da
 * esfera esta ali, qual longitude e latitude ele tem e que cor o mapa guarda
 * naquele lugar. Nenhum poligono precisa ser recortado no horizonte, que e a
 * parte chata de desenhar globo.
 */

/** Para onde o globo esta virado, em radianos. */
export interface Rotation {
  lon: number
  lat: number
}

/** O disco do globo na tela. */
export interface Sphere {
  cx: number
  cy: number
  r: number
}

export interface Texture {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Luz vinda de cima e da esquerda, so para a bola parecer bola. */
const LIGHT: [number, number, number] = [-0.42, 0.44, 0.79]
const AMBIENT = 0.62
const DIFFUSE = 0.38

export function clampLat(lat: number): number {
  const limite = Math.PI / 2 - 0.001
  return lat < -limite ? -limite : lat > limite ? limite : lat
}

/**
 * A base do olhar: `f` aponta para o centro do globo, `r` para a direita da
 * tela e `u` para cima. Fica tudo pre-calculado porque o laco de pixels nao
 * pode pagar seno e cosseno a cada passo.
 */
function basis(rot: Rotation) {
  const cosLat = Math.cos(rot.lat)
  const sinLat = Math.sin(rot.lat)
  const cosLon = Math.cos(rot.lon)
  const sinLon = Math.sin(rot.lon)
  return {
    fx: cosLat * cosLon,
    fy: sinLat,
    fz: cosLat * sinLon,
    rx: -sinLon,
    ry: 0,
    rz: cosLon,
    ux: -sinLat * cosLon,
    uy: cosLat,
    uz: -sinLat * sinLon,
  }
}

/**
 * Pinta o globo em `out`. Fora do disco o alfa fica em zero, para o fundo da
 * tela aparecer em volta.
 *
 * `step` maior desenha em resolucao menor (usado enquanto a mao arrasta): o
 * laco anda de 2 em 2 pixels e repete a cor no quadrado.
 */
export function renderGlobe(
  out: ImageData,
  tex: Texture,
  sphere: Sphere,
  rot: Rotation,
  step = 1,
): void {
  const { cx, cy, r } = sphere
  const b = basis(rot)
  const px = out.data
  const W = out.width
  const H = out.height
  const r2 = r * r
  const invR = 1 / r
  const tw = tex.width
  const th = tex.height
  const TAU = Math.PI * 2

  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(W - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(H - 1, Math.ceil(cy + r))

  px.fill(0)

  for (let y = y0; y <= y1; y += step) {
    const dy = y - cy
    const ny = -dy * invR
    for (let x = x0; x <= x1; x += step) {
      const dx = x - cx
      if (dx * dx + dy * dy > r2) continue
      const nx = dx * invR
      const nz2 = 1 - nx * nx - ny * ny
      if (nz2 <= 0) continue
      const nz = Math.sqrt(nz2)

      // O ponto da esfera, no mundo.
      const wx = nx * b.rx + ny * b.ux + nz * b.fx
      const wy = ny * b.uy + nz * b.fy
      const wz = nx * b.rz + ny * b.uz + nz * b.fz

      const lat = Math.asin(wy < -1 ? -1 : wy > 1 ? 1 : wy)
      const lon = Math.atan2(wz, wx)

      let u = ((lon + Math.PI) / TAU) * tw
      let v = ((Math.PI / 2 - lat) / Math.PI) * th
      u = u < 0 ? 0 : u >= tw ? tw - 1 : u
      v = v < 0 ? 0 : v >= th ? th - 1 : v
      const t = ((v | 0) * tw + (u | 0)) * 4

      const dot = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
      const shade = AMBIENT + DIFFUSE * (dot > 0 ? dot : 0)

      const red = tex.data[t] * shade
      const green = tex.data[t + 1] * shade
      const blue = tex.data[t + 2] * shade

      for (let sy = 0; sy < step; sy++) {
        const yy = y + sy
        if (yy > y1) break
        for (let sx = 0; sx < step; sx++) {
          const xx = x + sx
          if (xx > x1) break
          const o = (yy * W + xx) * 4
          px[o] = red
          px[o + 1] = green
          px[o + 2] = blue
          px[o + 3] = 255
        }
      }
    }
  }
}

/** Onde cai na tela um ponto do mapa, e se ele esta na face visivel. */
export function projectPoint(
  lon: number,
  lat: number,
  sphere: Sphere,
  rot: Rotation,
): { x: number; y: number; visible: boolean } {
  const b = basis(rot)
  const cosLat = Math.cos(lat)
  const wx = cosLat * Math.cos(lon)
  const wy = Math.sin(lat)
  const wz = cosLat * Math.sin(lon)
  const nz = wx * b.fx + wy * b.fy + wz * b.fz
  const nx = wx * b.rx + wz * b.rz
  const ny = wx * b.ux + wy * b.uy + wz * b.uz
  return {
    x: sphere.cx + nx * sphere.r,
    y: sphere.cy - ny * sphere.r,
    visible: nz > 0,
  }
}

/** Pixel do mapa -> longitude e latitude. */
export function lonLatOf(
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number] {
  return [(x / width) * Math.PI * 2 - Math.PI, Math.PI / 2 - (y / height) * Math.PI]
}

/** Tela -> longitude e latitude, ou null se o clique caiu fora do disco. */
export function unproject(
  x: number,
  y: number,
  sphere: Sphere,
  rot: Rotation,
): [number, number] | null {
  const dx = (x - sphere.cx) / sphere.r
  const dy = -(y - sphere.cy) / sphere.r
  const nz2 = 1 - dx * dx - dy * dy
  if (nz2 <= 0) return null
  const nz = Math.sqrt(nz2)
  const b = basis(rot)
  const wx = dx * b.rx + dy * b.ux + nz * b.fx
  const wy = dy * b.uy + nz * b.fy
  const wz = dx * b.rz + dy * b.uz + nz * b.fz
  return [Math.atan2(wz, wx), Math.asin(wy < -1 ? -1 : wy > 1 ? 1 : wy)]
}
