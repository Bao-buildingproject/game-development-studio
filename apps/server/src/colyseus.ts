// colyseus@0.15 ships CommonJS; re-export through the default object for Node ESM.
import colyseus from 'colyseus';
export type { Client } from 'colyseus';
export const { Room, Server } = colyseus;
