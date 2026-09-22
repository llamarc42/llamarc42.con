declare module "@modelcontextprotocol/ext-apps/app-bridge" {
  // Compatibility declarations for this project's legacy Node module resolver.
  export const AppBridge: typeof import("@modelcontextprotocol/ext-apps/dist/src/app-bridge").AppBridge;
  export type AppBridge =
    import("@modelcontextprotocol/ext-apps/dist/src/app-bridge").AppBridge;
  export const buildAllowAttribute: typeof import("@modelcontextprotocol/ext-apps/dist/src/app-bridge").buildAllowAttribute;
}
