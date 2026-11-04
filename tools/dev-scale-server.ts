// Keep the debug flag on the server process; the browser never controls whether the mode is enabled.
process.env.PCB_DEV_SCALE = '1';
await import('../server/main.js');
export {};
