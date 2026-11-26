import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import type { Database } from './db/client'
import { HttpError } from './errors'
import { bodyRoutes } from './bodies/routes'

export interface AppOptions {
  db: Database
  maxUploadBytes: number
  logger?: boolean
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
  })

  await app.register(multipart, {
    limits: {
      fileSize: opts.maxUploadBytes,
      files: 5,
      fields: 20,
      // O JSON do mundo vai num campo de texto; com muitos pontos, passa de 1 MB.
      fieldSize: 16 * 1024 * 1024,
    },
    throwFileSizeLimit: true,
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.message })
    }
    const status = (error as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as Error).message })
    }
    app.log.error(error)
    return reply.code(500).send({ error: 'Erro interno' })
  })

  app.get('/api/health', async () => ({ ok: true }))
  await app.register(bodyRoutes, { db: opts.db })
  return app
}
