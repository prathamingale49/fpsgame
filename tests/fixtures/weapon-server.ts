import { defineServer, defineRoom, type Client } from 'colyseus';
import { GameRoom, PracticeRoom, setActiveMap } from '../../server/room.js';
import { testMap } from '../../shared/game.js';
setActiveMap({ ...testMap, width: 20, depth: 20, boxes: [], spawns: [[0, 0, 0]] });
class WeaponPractice extends PracticeRoom {
  onJoin(client: Client, options: { name?: string; protocol?: number }) {
    super.onJoin(client, options); this.state.npcMovement = false;
    for (let i = 0; i < 5; i++) { const p = this.state.players.get(`npc-${i}`)!; p.x = i ? 6 : 0; p.z = i ? i : -2; }
  }
}
await defineServer({ rooms: { pcb: defineRoom(GameRoom), practice: defineRoom(WeaponPractice) }, express: router => {
  router.get('/api/health', (_req, res) => res.json({ ok: true }));
} }).listen(Number(process.env.PORT));
