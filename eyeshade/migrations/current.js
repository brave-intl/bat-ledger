import { lstatSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function getCurrent () {
  const dirs = readdirSync(__dirname).filter((name) => lstatSync(join(__dirname, name)).isDirectory())
  const migrations = dirs.sort().reverse()
  return migrations[0] ? migrations[0].split('_')[0] : migrations
}
