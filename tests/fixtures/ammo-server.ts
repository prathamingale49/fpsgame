// Test-only controls for placing a player at a spool and setting reserve levels.
import { defineServer, defineRoom, type Client } from 'colyseus';
import { GameRoom, PracticeRoom, setActiveMap } from '../../server/room.js';
import { PickupState, WeaponPickupState } from '../../server/state.js';
import { testMap } from '../../shared/game.js';
setActiveMap({ ...testMap, boxes: [], spawns: [[5,0,0]], back: { enabled:true, thickness:1.6, boxes:[] } });
function setup(room: GameRoom) {
  room.state.pickups.clear();
  room.state.pickups.set('ammo',new PickupState({x:0,y:.2,z:0}));
  room.state.weaponPickups.clear();
  for (const weapon of ['iron','pump','air','sniper']) room.state.weaponPickups.set(weapon,new WeaponPickupState({x:5,y:0,z:0,side:'front',weapon}));
  room.onMessage('test:position',(client: Client, data: {x?:number;side?:string;reserve?:number;spoolSide?:string})=>{
    const player=room.state.players.get(client.sessionId)!;
    if(data.x!==undefined) player.x=data.x;
    if(data.side!==undefined) player.side=data.side;
    if(data.reserve!==undefined) player.reserve=data.reserve;
    if(data.spoolSide!==undefined) room.state.pickups.get('ammo')!.side=data.spoolSide;
  });
}
class AmmoRoom extends GameRoom { onCreate() {super.onCreate();setup(this);} }
class AmmoPractice extends PracticeRoom {
  onCreate() {super.onCreate();setup(this);}
  onJoin(client: Client, options: {name?:string;protocol?:number}) {
    super.onJoin(client,options); this.state.npcMovement=false;
    for(const npc of this.state.players.values()) if(npc.npc) {npc.x=8;npc.z=8;}
  }
}
await defineServer({rooms:{pcb:defineRoom(AmmoRoom),practice:defineRoom(AmmoPractice)},express:router=>{
  router.get('/api/health',(_req,res)=>res.json({ok:true}));
}}).listen(Number(process.env.PORT));
