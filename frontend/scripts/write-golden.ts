/**
 * Writes golden-vectors.json at the repo root from the TypeScript engine.
 *
 *   npm run golden
 *
 * Run it only when the scoring rules change on purpose. The Java and Python
 * suites then fail until their engines produce the same numbers.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildGolden } from '../src/lib/scoring/golden'

const target = fileURLToPath(new URL('../../golden-vectors.json', import.meta.url))
writeFileSync(target, JSON.stringify(buildGolden(), null, 2) + '\n', 'utf8')
console.log(`wrote ${target}`)
