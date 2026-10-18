declare module '*.wasm' {
  /** A compiled WebAssembly.Module (wrangler's CompiledWasm rule). */
  const module: object;
  export default module;
}
