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
export function basis(rot: Rotation) {
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
 *
 * `roll` e a inclinacao do eixo, em radianos, no sentido horario da tela: o
 * corpo inteiro tomba, e o giro (rot.lon) passa a ser em volta do eixo
 * inclinado.
 */
export function renderGlobe(
  out: ImageData,
  tex: Texture,
  sphere: Sphere,
  rot: Rotation,
  step = 1,
  roll = 0,
): void {
  const { cx, cy, r } = sphere
  const b = basis(rot)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
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
    for (let x = x0; x <= x1; x += step) {
      const dx = x - cx
      if (dx * dx + dy * dy > r2) continue
      // Desfaz a inclinacao: o ponto da tela no referencial do corpo.
      const nx = (dx * cr + dy * sr) * invR
      const ny = -(-dx * sr + dy * cr) * invR
      const nz2 = 1 - nx * nx - ny * ny
      if (nz2 <= 0) continue
      const nz = Math.sqrt(nz2)

      // O ponto da esfera, no mundo.
      const wx = nx * b.rx + ny * b.ux + nz * b.fx
      const wy = ny * b.uy + nz * b.fy
      const wz = nx * b.rz + ny * b.uz + nz * b.fz

      const lat = Math.asin(wy < -1 ? -1 : wy > 1 ? 1 : wy)
      const lon = Math.atan2(wz, wx)

      // Bilinear: mistura os 4 texels em volta. Sem isso, de perto cada
      // texel vira um quadrado e a borda entre duas cores, uma escada.
      // Na horizontal a textura da a volta (o mapa fecha no antimeridiano).
      let u = ((lon + Math.PI) / TAU) * tw - 0.5
      let v = ((Math.PI / 2 - lat) / Math.PI) * th - 0.5
      v = v < 0 ? 0 : v > th - 1 ? th - 1 : v
      if (u < 0) u += tw
      const u0 = u | 0
      const v0 = v | 0
      const fu = u - u0
      const fv = v - v0
      const u1 = u0 + 1 >= tw ? 0 : u0 + 1
      const v1 = v0 + 1 >= th ? th - 1 : v0 + 1
      const ua = u0 >= tw ? tw - 1 : u0
      const t00 = (v0 * tw + ua) * 4
      const t10 = (v0 * tw + u1) * 4
      const t01 = (v1 * tw + ua) * 4
      const t11 = (v1 * tw + u1) * 4
      const w00 = (1 - fu) * (1 - fv)
      const w10 = fu * (1 - fv)
      const w01 = (1 - fu) * fv
      const w11 = fu * fv
      const d = tex.data

      // A luz vem de um lugar fixo da tela, nao do referencial do corpo.
      const lx = dx * invR
      const ly = -dy * invR
      const dot = lx * LIGHT[0] + ly * LIGHT[1] + nz * LIGHT[2]
      const shade = AMBIENT + DIFFUSE * (dot > 0 ? dot : 0)

      const red = (d[t00] * w00 + d[t10] * w10 + d[t01] * w01 + d[t11] * w11) * shade
      const green =
        (d[t00 + 1] * w00 + d[t10 + 1] * w10 + d[t01 + 1] * w01 + d[t11 + 1] * w11) * shade
      const blue =
        (d[t00 + 2] * w00 + d[t10 + 2] * w10 + d[t01 + 2] * w01 + d[t11 + 2] * w11) * shade

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
  roll = 0,
): { x: number; y: number; visible: boolean } {
  const b = basis(rot)
  const cosLat = Math.cos(lat)
  const wx = cosLat * Math.cos(lon)
  const wy = Math.sin(lat)
  const wz = cosLat * Math.sin(lon)
  const nz = wx * b.fx + wy * b.fy + wz * b.fz
  const nx = wx * b.rx + wz * b.rz
  const ny = wx * b.ux + wy * b.uy + wz * b.uz
  // Do referencial do corpo para a tela, refazendo a inclinacao.
  const bx = nx * sphere.r
  const by = -ny * sphere.r
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  return {
    x: sphere.cx + bx * cr - by * sr,
    y: sphere.cy + bx * sr + by * cr,
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
