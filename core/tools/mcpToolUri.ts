export function encodeMCPToolUri(mcpId: string, toolName: string): string {
  return `mcp://${encodeURIComponent(mcpId)}/${encodeURIComponent(toolName)}`;
}

export function decodeMCPToolUri(uri: string): [string, string] | null {
  const url = new URL(uri);
  if (url.protocol !== "mcp:") return null;
  return [
    decodeURIComponent(url.hostname),
    decodeURIComponent(url.pathname).slice(1),
  ];
}

/** An embedded app can request another tool on its original server only. */
export function mcpAppToolUri(
  sourceUri: string | undefined,
  toolName: string,
): string {
  const identity = sourceUri ? decodeMCPToolUri(sourceUri) : null;
  if (!identity || !identity[0])
    throw new Error("MCP app has no saved server identity");
  return encodeMCPToolUri(identity[0], toolName);
}
