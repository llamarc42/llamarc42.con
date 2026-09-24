import type { Tool } from "..";
import { gitStatusTool } from "./gitStatus";

/** Resolve against current config without substituting a different tool identity. */
export function resolveToolCall(
  tools: Tool[],
  name: string,
  toolUri?: string | null,
): Tool | undefined {
  if (name === "git_status") {
    // This name is reserved for the built-in. Old name-only calls and MCP calls
    // cannot establish that identity, even when the built-in is now enabled.
    if (toolUri !== null) return undefined;
    // Disabled built-ins are absent from discovery. Their handler must still
    // recheck enablement and return the contract's tool_disabled envelope.
    return (
      tools.find((tool) => tool.function.name === name && !tool.uri) ??
      gitStatusTool()
    );
  }
  return tools.find(
    (tool) =>
      tool.function.name === name &&
      (toolUri === undefined
        ? !/^mcp:/i.test(tool.uri ?? "")
        : (tool.uri ?? null) === toolUri),
  );
}
