import { expect, it } from 'vitest';
import { CloseCode, Client, type Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { MatchState } from '../server/state.js';
import { MOVEMENT_PROTOCOL } from '../shared/game.js';

it('retains random maps across joins, reconnection and round resets in isolated rooms', async () => {
  const server = spawn(process.execPath, ['--import','tsx','tests/fixtures/map-isolation-server.ts'], { env: { ...process.env, PORT:'26715', PCB_ROTATE_TEST:'1', PCB_TEST_MATCH_SECONDS:'.3' }, stdio:['ignore','pipe','pipe'] });
  let ready=false, logs=''; server.stdout.on('data', chunk=>{ logs+=chunk; ready=logs.includes('MAP_ISOLATION_READY'); });
  server.stderr.on('data',chunk=>{logs+=chunk;});
  const rooms: Room<MatchState>[]=[];
  const wait=async (fn:()=>boolean,ms=8000)=>{const until=Date.now()+ms;while(!fn() && Date.now()<until) await delay(25);expect(fn(),logs).toBe(true);};
  try {
    await wait(()=>ready);
    const client=new Client('ws://localhost:26715'), options={protocol:MOVEMENT_PROTOCOL};
    const ids=new Set<string>();
    const originals: Room<MatchState>[]=[];
    for(let i=0;i<9;i++) {
      const room=await client.create<MatchState>('pcb', {...options,mapId:'untrusted-client-choice'});rooms.push(room); originals.push(room);room.onMessage('*',()=>{});
      await wait(()=>room.state.players?.size===1);
      ids.add(room.state.mapId);
      expect(room.state.weaponPickups.size).toBe(11);
      const counts=[...room.state.weaponPickups.values()].reduce((counts,p)=>{counts[p.weapon]=(counts[p.weapon]??0)+1;return counts;},{} as Record<string,number>);
      expect(counts).toEqual({iron:3,air:3,pump:3,sniper:2});
    }
    expect([...ids].sort()).toEqual(['bms','flight-sam','recovery']);
    const first=originals[0], id=first.state.mapId;
    const peer=await client.joinById<MatchState>(first.roomId,options);rooms.push(peer);peer.onMessage('*',()=>{});
    await wait(()=>peer.state.players?.size===2);
    expect(peer.state.mapId).toBe(id);
    // Auto reconnect uses the same room and session, rather than reselecting.
    let reconnected=false; first.onReconnect(()=>{reconnected=true;});first.reconnection.minUptime=0;first.connection.close(CloseCode.MAY_TRY_RECONNECT);
    await wait(()=>reconnected,10000);
    expect(first.state.mapId).toBe(id);
    await wait(()=>first.state.phase==='ended');
    await wait(()=>first.state.phase==='playing',10000);
    expect(first.state.mapId).toBe(id);expect(peer.state.mapId).toBe(id);
    expect(originals.every(room=>ids.has(room.state.mapId))).toBe(true);
    const privateRoom=await client.create<MatchState>('pcb',{...options,private:true}); rooms.push(privateRoom);privateRoom.onMessage('*',()=>{});
    const matched=await client.joinOrCreate<MatchState>('pcb',options);rooms.push(matched);matched.onMessage('*',()=>{});
    expect(matched.roomId).not.toBe(privateRoom.roomId);
    const practice=await client.create<MatchState>('practice',{...options,mapId:'recovery'});rooms.push(practice);practice.onMessage('*',()=>{});
    await wait(()=>practice.state.players?.size===6);
    expect(practice.state.mapId).toBe('recovery'); expect(first.state.mapId).toBe(id);
  } finally { for(const room of rooms) try {await room.leave();} catch {} server.kill(); }
},60000);
