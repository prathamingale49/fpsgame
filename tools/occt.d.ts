declare module 'occt-import-js' {
  const init: () => Promise<{ ReadStepFile(data: Uint8Array, options: Record<string, unknown>): unknown }>;
  export default init;
}
