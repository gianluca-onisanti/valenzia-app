/**
 * Projecoes de entrada.
 *
 * O app guarda todo mapa em equirretangular: cada linha e um circulo de
 * latitude, e o globo, as areas e as ferramentas contam com isso. Mas quem
 * desenha um mapa-mundi "plano" costuma pensar em Mercator, que preserva a
 * forma local -- e, lido como equirretangular, o que encosta no topo do
 * desenho vira cunha no polo.
 *
 * Aqui esta a conversao Mercator -> equirretangular. Nas duas projecoes a
 * longitude e a mesma (a volta inteira na largura), entao cada coluna fica
 * onde esta: so as linhas mudam de lugar. A escala no equador tambem e a
 * mesma (W/2pi pixels por radiano); perto do limite, a origem e comprimida.
 */

export type SourceProjection = 'equirect' | 'mercator'

/** y de Mercator (em radianos de "altura") de uma latitude. */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat / 2))

/**
 * Ate que latitude (em radianos) vai uma imagem Mercator de largura `w` e
 * altura `h`, com a volta inteira na largura. 2:1 da ~66,5 graus.
 */
export function mercatorMaxLat(w: number, h: number): number {
  return 2 * Math.atan(Math.exp((Math.PI * h) / w)) - Math.PI / 2
}

/** A altura equirretangular correta para uma largura: 2:1. */
export function equirectHeight(w: number): number {
  return Math.max(1, Math.round(w / 2))
}

/**
 * Posicao continua: y de uma imagem Mercator (srcW x srcH) -> y no mapa
 * equirretangular de altura dstH.
 */
export function mercatorY(y: number, srcW: number, srcH: number, dstH: number): number {
  const lat = 2 * Math.atan(Math.exp(((srcH / 2 - y) * 2 * Math.PI) / srcW)) - Math.PI / 2
  return ((Math.PI / 2 - lat) / Math.PI) * dstH
}

/**
 * Para cada linha do destino, a linha da origem que ela recebe -- ou -1 se
 * cair alem do que a imagem cobre (a calota polar).
 */
export function mercatorRowMap(srcW: number, srcH: number, dstH: number): Int32Array {
  const map = new Int32Array(dstH)
  const max = mercatorMaxLat(srcW, srcH)
  const k = srcW / (2 * Math.PI)
  for (let y = 0; y < dstH; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / dstH) * Math.PI
    if (Math.abs(lat) >= max) {
      map[y] = -1
      continue
    }
    const sy = Math.floor(srcH / 2 - mercY(lat) * k)
    map[y] = sy < 0 ? 0 : sy >= srcH ? srcH - 1 : sy
  }
  return map
}

/**
 * Monta as linhas do destino copiando as da origem pelo `rowMap`. `stride` e
 * quantos valores por pixel (1 numa camada, 4 em RGBA). Linha -1 recebe
 * `fill` (um valor por canal).
 */
export function remapRows<T extends Uint16Array | Uint8ClampedArray | Uint8Array>(
  src: T,
  width: number,
  rowMap: Int32Array,
  fill: number[],
  stride = 1,
): T {
  const rowLen = width * stride
  const out = new (src.constructor as new (n: number) => T)(rowMap.length * rowLen)
  for (let y = 0; y < rowMap.length; y++) {
    const from = rowMap[y]
    const at = y * rowLen
    if (from >= 0) {
      out.set(src.subarray(from * rowLen, from * rowLen + rowLen), at)
    } else {
      for (let i = 0; i < rowLen; i += stride) {
        for (let c = 0; c < stride; c++) out[at + i + c] = fill[c] ?? 0
      }
    }
  }
  return out
}
