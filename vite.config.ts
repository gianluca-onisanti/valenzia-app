import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const DATA_DIR = resolve(process.cwd(), 'public/data')
/** Teto por requisicao; as camadas sao PNGs de algumas centenas de KB. */
const MAX_BODY = 32 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Corpo grande demais'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function ok(res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  res.end('{"ok":true}')
}

function fail(res: ServerResponse, code: number, message: string) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ ok: false, error: message }))
}

/**
 * Em dev, deixa o botao Salvar gravar o mundo e as duas camadas pintadas
 * direto em public/data/, para que o trabalho fique versionado no git em vez
 * de preso no navegador.
 */
function projectWriter(): Plugin {
  return {
    name: 'valenzia-project-writer',
    configureServer(server) {
      server.middlewares.use('/__api/world', (req, res, next) => {
        if (req.method !== 'POST') return next()
        readBody(req)
          .then(async (body) => {
            const text = body.toString('utf8')
            JSON.parse(text)
            await mkdir(DATA_DIR, { recursive: true })
            await writeFile(resolve(DATA_DIR, 'world.json'), text, 'utf8')
            ok(res)
          })
          .catch((err: Error) => fail(res, 400, err.message))
      })

      server.middlewares.use('/__api/layer', (req, res, next) => {
        if (req.method !== 'POST') return next()
        // O middleware recebe a url ja sem o prefixo: "/territory".
        const name = (req.url ?? '').replace(/^\/+/, '').split('?')[0]
        if (name !== 'territory' && name !== 'biome' && name !== 'land') {
          return fail(res, 404, 'Camada desconhecida: ' + name)
        }
        readBody(req)
          .then(async (body) => {
            if (body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
              throw new Error('Conteudo nao e um PNG')
            }
            await mkdir(DATA_DIR, { recursive: true })
            await writeFile(resolve(DATA_DIR, name + '.png'), body)
            ok(res)
          })
          .catch((err: Error) => fail(res, 400, err.message))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), projectWriter()],
})
