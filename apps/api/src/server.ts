import { buildApp } from './app'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { env } from './env'

async function main() {
  if (env.migrateOnStart) {
    await runMigrations(env.databaseUrl)
    console.log('Migracoes aplicadas.')
  }
  const { db, sql } = createDb(env.databaseUrl)
  const app = await buildApp({ db, maxUploadBytes: env.maxUploadBytes, logger: true })

  const shutdown = async () => {
    await app.close()
    await sql.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await app.listen({ port: env.port, host: env.host })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
