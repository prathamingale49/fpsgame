import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema({
  name: t.string().default('Engineer'),
  x: t.float32().default(0), y: t.float32().default(0), z: t.float32().default(0),
  vy: t.float32().default(0), grounded: t.boolean().default(true),
  yaw: t.float32().default(0), pitch: t.float32().default(0),
  hp: t.uint8().default(100), ammo: t.uint8().default(30), reserve: t.uint16().default(60),
  kills: t.uint16().default(0), deaths: t.uint16().default(0),
  alive: t.boolean().default(true), reloading: t.boolean().default(false),
  ack: t.uint32().default(0), connected: t.boolean().default(true),
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;
export const PickupState = schema({ x: t.float32(), y: t.float32(), z: t.float32(), active: t.boolean().default(true) }, 'PickupState');
export type PickupState = SchemaType<typeof PickupState>;

export const MatchState = schema({
  players: t.map(PlayerState),
  pickups: t.map(PickupState),
  phase: t.string().default('waiting'),
  seconds: t.uint16().default(300),
  winner: t.string().default(''),
  mapId: t.string().default('test'),
  playerHeight: t.float32().default(1.8),
}, 'MatchState');
export type MatchState = SchemaType<typeof MatchState>;
