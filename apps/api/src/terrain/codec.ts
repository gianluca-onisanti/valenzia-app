import sharp from 'sharp'

/**
 * As camadas sao rasters de um numero por pixel (slot de pais, codigo de
 * material...), gravadas como PNG com o numero em R + G*256 -- o mesmo
 * formato que o `encodeLayer`/`decodeLayer` do editor usa no navegador.
 *
 * O valor e um rotulo, nao uma cor: nada de paleta, nada de perfil de cor,
 * nada de suavizacao. Um bit trocado aqui inventa um pais.
 */
export async function encodeLayerPng(
  layer: Uint16Array,
  width: number,
  height: number,
): Promise<Buffer> {
  if (layer.length !== width * height) {
    throw new Error('Camada com ' + layer.length + ' posicoes para ' + width + 'x' + height)
  }
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < layer.length; i++) {
    const v = layer[i]
    raw[i * 3] = v & 0xff
    raw[i * 3 + 1] = (v >> 8) & 0xff
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

export interface PngInfo {
  width: number
  height: number
}

/** Confere que o buffer e um PNG e devolve as dimensoes. */
export async function pngInfo(png: Buffer): Promise<PngInfo> {
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Conteudo nao e um PNG')
  }
  const meta = await sharp(png).metadata()
  if (!meta.width || !meta.height) throw new Error('PNG sem dimensoes')
  return { width: meta.width, height: meta.height }
}

export async function decodeLayerPng(png: Buffer): Promise<{
  layer: Uint16Array
  width: number
  height: number
}> {
  const { data, info } = await sharp(png, { failOn: 'error' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const layer = new Uint16Array(width * height)
  if (channels === 1 || channels === 2) {
    // Cinza: so existe o canal "R".
    for (let i = 0; i < layer.length; i++) layer[i] = data[i * channels]
  } else {
    for (let i = 0; i < layer.length; i++) {
      layer[i] = data[i * channels] | (data[i * channels + 1] << 8)
    }
  }
  return { layer, width, height }
}

/** Uma camada inteira com o mesmo valor: o terreno de um mapa em branco. */
export function filledLayer(width: number, height: number, value: number): Uint16Array {
  const layer = new Uint16Array(width * height)
  if (value !== 0) layer.fill(value)
  return layer
}
