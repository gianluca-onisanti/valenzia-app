/**
 * Preparo do mapa em branco.
 *
 * Le a imagem crua -- terra de uma cor, oceano de outra, costa desenhada em
 * preto -- e produz o gabarito que o editor usa para saber onde a tinta pode
 * encostar:
 *
 *   public/mask.png       - terra em branco, agua em preto. Leia pelo canal
 *                           vermelho: o PNG e paletizado e volta em RGB.
 *   public/coast.png      - a linha de costa em preto com alpha, para
 *                           desenhar por cima da pintura.
 *   public/data/geo.json  - dimensoes, as duas cores e quanto do mapa e terra.
 *
 * Nada aqui define paises: fronteiras, biomas e mares sao pintados no app e
 * vivem nas camadas salvas separadamente. Esta etapa so responde "este pixel
 * e terra ou mar?", e so precisa rodar de novo se o desenho do mundo mudar.
 */
import sharp from 'sharp'
import { readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SOURCE_DIR = path.join(ROOT, 'public', 'source')
const PUBLIC_DIR = path.join(ROOT, 'public')
const DATA_DIR = path.join(ROOT, 'public', 'data')

/**
 * Abaixo deste valor (o maximo do RGB) o pixel e traco de costa, nao terra
 * nem mar. O criterio e o valor e nao a luminancia porque cores saturadas
 * podem ser escuras em luminancia sem serem pretas.
 */
const INK_VALUE = 105
/**
 * Manchas conexas menores que isto sao ruido de antialias, nao geografia:
 * um pontinho de 1px nao da para clicar nem pintar. Ilhas de verdade neste
 * mapa passam de 200px.
 */
const MIN_FEATURE = 32

const args = process.argv.slice(2)

function value(r, g, b) {
  return r > g ? (r > b ? r : b) : g > b ? g : b
}

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

async function findSource() {
  const explicit = args.find((a) => !a.startsWith('--'))
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit)
    if (!existsSync(p)) throw new Error('Imagem nao encontrada: ' + p)
    return p
  }
  if (!existsSync(SOURCE_DIR)) {
    throw new Error('Crie a pasta public/source e coloque o mapa em branco nela.')
  }
  const files = (await readdir(SOURCE_DIR)).filter((f) =>
    /\.(png|jpe?g|webp|tiff?)$/i.test(f),
  )
  if (files.length === 0) {
    throw new Error(
      'Nenhuma imagem em public/source.\n' +
        'Salve a imagem so com terra e oceano como public/source/base.png',
    )
  }
  // O nome do arquivo e so uma conveniencia: havendo uma imagem so, e ela.
  const chosen =
    files.find((f) => /^base\./i.test(f)) ??
    files.find((f) => /base|branco|vazio/i.test(f)) ??
    (files.length === 1 ? files[0] : null)
  if (!chosen) {
    throw new Error(
      'Ha varias imagens em public/source e nenhuma se chama base.png:\n  ' +
        files.join('\n  ') +
        '\nRenomeie a certa para base.png, ou passe o caminho:\n' +
        '  npm run prepare:map -- public/source/<arquivo>',
    )
  }
  return path.join(SOURCE_DIR, chosen)
}

/**
 * As duas cores que dominam a imagem. A agua e a que toca o canto superior
 * esquerdo; a outra e a terra.
 */
function findColors(data, width, height) {
  const counts = new Map()
  const total = width * height
  for (let i = 0; i < total; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    if (value(r, g, b) < INK_VALUE) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const prev = counts.get(key)
    if (prev) {
      prev.n++
      prev.r += r
      prev.g += g
      prev.b += b
    } else {
      counts.set(key, { n: 1, r, g, b })
    }
  }
  const ranked = [...counts.values()]
    .map((c) => ({
      r: Math.round(c.r / c.n),
      g: Math.round(c.g / c.n),
      b: Math.round(c.b / c.n),
      n: c.n,
    }))
    .sort((a, b) => b.n - a.n)

  if (ranked.length < 2) {
    throw new Error('A imagem precisa ter duas cores: uma de terra e uma de mar.')
  }

  const corner = { r: data[0], g: data[1], b: data[2] }
  const dist = (c) =>
    (c.r - corner.r) ** 2 + (c.g - corner.g) ** 2 + (c.b - corner.b) ** 2
  // O canto superior esquerdo e mar aberto, por convencao.
  const top = ranked.slice(0, 6)
  const water = top.reduce((best, c) => (dist(c) < dist(best) ? c : best), top[0])
  const land = top.find((c) => c !== water)
  return { land, water, considered: ranked.length }
}

/**
 * Troca de lado toda mancha conexa menor que MIN_FEATURE. Devolve quantas
 * manchas de cada tipo foram removidas.
 */
function despeckle(mask, width, height) {
  const total = width * height
  const seen = new Uint8Array(total)
  const stack = new Int32Array(total)
  const removed = { land: 0, water: 0 }

  for (let seed = 0; seed < total; seed++) {
    if (seen[seed]) continue
    const side = mask[seed]
    let sp = 0
    let n = 0
    stack[sp++] = seed
    seen[seed] = 1
    // Guarda a mancha inteira no topo da pilha para poder virar depois.
    const members = []
    while (sp > 0) {
      const p = stack[--sp]
      members.push(p)
      n++
      const x = p % width
      const y = (p - x) / width
      if (x > 0 && !seen[p - 1] && mask[p - 1] === side) {
        seen[p - 1] = 1
        stack[sp++] = p - 1
      }
      if (x < width - 1 && !seen[p + 1] && mask[p + 1] === side) {
        seen[p + 1] = 1
        stack[sp++] = p + 1
      }
      if (y > 0 && !seen[p - width] && mask[p - width] === side) {
        seen[p - width] = 1
        stack[sp++] = p - width
      }
      if (y < height - 1 && !seen[p + width] && mask[p + width] === side) {
        seen[p + width] = 1
        stack[sp++] = p + width
      }
    }
    if (n >= MIN_FEATURE) continue
    const flipped = side === 1 ? 0 : 1
    for (const p of members) mask[p] = flipped
    if (side === 1) removed.land++
    else removed.water++
  }
  return removed
}

async function run() {
  const sourcePath = await findSource()
  console.log('> Lendo ' + path.relative(ROOT, sourcePath))

  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const total = width * height
  console.log('  ' + width + ' x ' + height + ' (' + (total / 1e6).toFixed(1) + 'M pixels)')

  const { land, water } = findColors(data, width, height)
  console.log('> Terra ' + hex(land.r, land.g, land.b) + '  /  mar ' + hex(water.r, water.g, water.b))

  // -1 = traco de costa, resolvido logo abaixo; 1 = terra; 0 = mar.
  const mask = new Int8Array(total)
  let ink = 0
  for (let i = 0; i < total; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    if (value(r, g, b) < INK_VALUE) {
      mask[i] = -1
      ink++
      continue
    }
    const dl = (r - land.r) ** 2 + (g - land.g) ** 2 + (b - land.b) ** 2
    const dw = (r - water.r) ** 2 + (g - water.g) ** 2 + (b - water.b) ** 2
    mask[i] = dl <= dw ? 1 : 0
  }

  // O traco da costa e repartido entre terra e mar pela distancia: cada pixel
  // escuro vai para o lado mais proximo, de modo que nao sobra nenhum pixel
  // indefinido onde o pincel pudesse travar.
  console.log('> Repartindo ' + ink + ' pixels de traco entre terra e mar...')
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  for (let i = 0; i < total; i++) {
    if (mask[i] === -1) continue
    const x = i % width
    const y = (i - x) / width
    if (
      (x > 0 && mask[i - 1] === -1) ||
      (x < width - 1 && mask[i + 1] === -1) ||
      (y > 0 && mask[i - width] === -1) ||
      (y < height - 1 && mask[i + width] === -1)
    ) {
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const p = queue[head++]
    const v = mask[p]
    const x = p % width
    const y = (p - x) / width
    if (x > 0 && mask[p - 1] === -1) {
      mask[p - 1] = v
      queue[tail++] = p - 1
    }
    if (x < width - 1 && mask[p + 1] === -1) {
      mask[p + 1] = v
      queue[tail++] = p + 1
    }
    if (y > 0 && mask[p - width] === -1) {
      mask[p - width] = v
      queue[tail++] = p - width
    }
    if (y < height - 1 && mask[p + width] === -1) {
      mask[p + width] = v
      queue[tail++] = p + width
    }
  }

  // O antialias da costa deixa pixels isolados do lado errado: pontinhos de
  // terra boiando no mar e furos de mar dentro do continente. Sao pequenos
  // demais para alguem clicar e so sujariam a contagem de territorio, entao
  // cada mancha menor que MIN_FEATURE e devolvida ao lado oposto.
  const despeckled = despeckle(mask, width, height)
  console.log(
    '> Limpeza: ' +
      despeckled.land +
      ' pontos de terra e ' +
      despeckled.water +
      ' furos de mar removidos',
  )

  let landPixels = 0
  for (let i = 0; i < total; i++) if (mask[i] === 1) landPixels++

  await mkdir(PUBLIC_DIR, { recursive: true })
  await mkdir(DATA_DIR, { recursive: true })

  const maskPixels = Buffer.alloc(total)
  for (let i = 0; i < total; i++) maskPixels[i] = mask[i] === 1 ? 255 : 0
  await sharp(maskPixels, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9, colours: 2 })
    .toFile(path.join(PUBLIC_DIR, 'mask.png'))
  console.log('> public/mask.png')

  const coastPixels = Buffer.alloc(total * 4)
  for (let i = 0; i < total; i++) {
    const o = i * 4
    const v = value(data[o], data[o + 1], data[o + 2])
    coastPixels[o + 3] = v < INK_VALUE ? Math.round(255 * (1 - v / INK_VALUE)) : 0
  }
  await sharp(coastPixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, 'coast.png'))
  console.log('> public/coast.png')

  await writeFile(
    path.join(DATA_DIR, 'geo.json'),
    JSON.stringify({
      width,
      height,
      land: hex(land.r, land.g, land.b),
      water: hex(water.r, water.g, water.b),
      landPixels,
    }),
  )
  console.log('> public/data/geo.json')
  console.log(
    '  terra ocupa ' + ((100 * landPixels) / total).toFixed(1) + '% do mapa',
  )

  console.log('\nPronto. Rode: npm run dev')
}

run().catch((err) => {
  console.error('\nFalhou: ' + err.message)
  process.exit(1)
})
