import type { GameModule, ScoreContribution, SessionMarkers } from '../lib/scoring/types'
import { duckRollCall } from './modules/duckRollCall'
import { familyGrove } from './modules/familyGrove'
import { grandmothersTale } from './modules/grandmothersTale'
import { journal } from './modules/journal'
import { koiAreJumping } from './modules/koiAreJumping'
import { lotusFrog } from './modules/lotusFrog'
import { morningRituals } from './modules/morningRituals'
import { weaversLoom } from './modules/weaversLoom'

/**
 * Every game Smaran knows. Adding a game is one module file and one line here
 * (docs/ADDING_A_GAME.md).
 *
 * The device scores a finished session with its module, the server accepts a
 * session only for a game listed in backend/.../game-registry.json, and the
 * dashboards read titles and domains from the server's copy. A test holds the two
 * copies to the same ids, titles, domains and targets.
 */
export const GAME_MODULES: readonly GameModule[] = [
  duckRollCall,
  grandmothersTale,
  familyGrove,
  morningRituals,
  lotusFrog,
  koiAreJumping,
  journal,
  weaversLoom,
]

export function moduleById(id: string): GameModule | undefined {
  return GAME_MODULES.find((m) => m.id === id)
}

export function moduleForType(gameType: string): GameModule | undefined {
  return GAME_MODULES.find((m) => m.gameType === gameType)
}

/** What a finished sitting said, from the game's own module. */
export function scoreWith(
  module: GameModule,
  trials: readonly unknown[],
  hourOfDay: number,
): { contributions: ScoreContribution[]; markers: SessionMarkers | undefined } {
  return {
    contributions: module.scoreSession([...trials], { hourOfDay }),
    markers: module.markers?.([...trials]),
  }
}
