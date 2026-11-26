/** Configuracao lida do ambiente, com os padroes do docker-compose de dev. */
export const env = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://valenzia:valenzia@localhost:5442/valenzia',
  port: Number(process.env.PORT ?? 3100),
  host: process.env.HOST ?? '0.0.0.0',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 30) * 1024 * 1024,
  /** Roda as migracoes pendentes ao subir. Ligado no container. */
  migrateOnStart: process.env.MIGRATE_ON_START === 'true',
}
