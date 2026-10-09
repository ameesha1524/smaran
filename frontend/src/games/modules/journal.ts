import type { GameModule } from '../../lib/scoring/types'

/**
 * The journal is not a game, but what she writes is read for how it feels and reaches the AFFECTIVE domain
 * through the same door every game uses, so it is listed beside them.
 *
 * It scores nothing on the tablet: the entry is sent to the server (POST /api/device/journal/analyse), which
 * reads it with a model it holds the key for, validates the answer, keeps only the signals (never her words)
 * and files a light AFFECTIVE contribution as a session of this id.
 */
export const journal: GameModule = {
  id: 'journal',
  gameType: 'JOURNAL',
  title: 'Journal',
  route: '/journal',
  primaryDomains: ['AFFECTIVE'],
  targets: ['AFFECTIVE'],
  scoreSession: () => [],
}
