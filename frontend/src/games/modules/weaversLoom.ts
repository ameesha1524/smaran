import type { GameModule } from '../../lib/scoring/types'

/**
 * The Weaver's Loom, retired. It is no longer played and nothing routes to it,
 * but sessions already stored under its id still load and still count toward
 * their domain's history, so its entry stays in the registry. It scores nothing:
 * it can no longer send a session, and the server refuses one.
 */
export const weaversLoom: GameModule = {
  id: 'weavers-loom',
  gameType: 'WEAVERS_LOOM',
  title: "Weaver's Loom",
  route: '/game/weavers-loom',
  primaryDomains: ['VISUAL_SEMANTIC'],
  targets: ['VISUAL_SEMANTIC', 'MOTOR'],
  retired: true,
  scoreSession: () => [],
}
