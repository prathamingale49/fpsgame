import { defineServer, defineRoom } from 'colyseus';
import express from 'express';
import path from 'node:path';
import { GameRoom, PracticeRoom, setActiveMap } from '../../server/room.js';
import { testMap, MOVEMENT_PROTOCOL } from '../../shared/game.js';
const map={...testMap,id:'flight-test',boxes:[],spawns:[[0,0,0],[0,0,-12],[8,0,0]] as [number,number,number][],back:{enabled:true,thickness:1.6,boxes:[]}};
setActiveMap(map);
await defineServer({rooms:{pcb:defineRoom(GameRoom),practice:defineRoom(PracticeRoom)},express:router=>{
  router.get('/api/health',(_req,res)=>res.json({ok:true,movementProtocol:MOVEMENT_PROTOCOL}));
  router.get('/api/map',(_req,res)=>res.json(map));
  router.use(express.static(path.resolve('dist')));
}}).listen(Number(process.env.PORT));
