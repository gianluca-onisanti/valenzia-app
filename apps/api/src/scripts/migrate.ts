import { runMigrations } from '../db/migrate'
import { env } from '../env'

runMigrations(env.databaseUrl)
  .then(() => console.log('Migracoes aplicadas.'))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
