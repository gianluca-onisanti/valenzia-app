/**
 * Roda o vitest a partir do caminho com a letra do drive em maiuscula.
 *
 * No Windows, "c:\..." e "C:\..." viram dois caminhos para o vitest, que
 * entao carrega o proprio runner duas vezes e nenhum teste roda. O terminal
 * do VS Code costuma abrir com a letra minuscula.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

let cwd = process.cwd()
if (process.platform === 'win32' && /^[a-z]:/.test(cwd)) cwd = cwd[0].toUpperCase() + cwd.slice(1)

const result = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
