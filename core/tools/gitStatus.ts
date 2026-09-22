import { fileURLToPath } from "node:url";
import { Tool, ToolExtras } from "..";
import { BUILT_IN_GROUP_NAME } from "./builtIn";
import {
  executeGitStatus,
  gitStatusRegistry,
} from "../../packages/tool-contract/src/git-status.js";

export function parseGitStatusArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "invalid_arguments: Git status requires a valid JSON object",
    );
  }
}
export function gitStatusTool(): Tool {
  const { registry, manifest } = gitStatusRegistry(true);
  const definition = registry.definitions()[0];
  return {
    type: "function",
    function: definition.function,
    displayTitle: manifest.displayName,
    wouldLikeTo: "read Git status in the workspace",
    isCurrently: "reading Git status in the workspace",
    hasAlready: "read Git status in the workspace",
    readonly: true,
    group: BUILT_IN_GROUP_NAME,
    defaultToolPolicy: "allowedWithPermission",
  };
}

export async function gitStatusImpl(args: unknown, extras: ToolExtras) {
  // Recheck host enablement at invocation time, including calls from old chats.
  const enabled =
    (await extras.ide.getIdeSettings()).enableGitStatusTool === true;
  if (!enabled)
    throw new Error("tool_disabled: Git status is disabled in editor settings");
  const roots = await extras.ide.getWorkspaceDirs();
  if (roots.length !== 1)
    throw new Error(
      "tool_failed: Git status requires exactly one workspace repository",
    );
  let workspace: string;
  try {
    workspace = fileURLToPath(roots[0]);
  } catch {
    throw new Error(
      "tool_failed: Workspace must be accessible to the extension host as a file URI",
    );
  }
  const result = await executeGitStatus({
    args,
    workspace,
    enabled,
    signal: undefined,
    invocationId: extras.toolCallId,
  });
  if ("error" in result)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return [
    {
      name: "Git status",
      description: "Workspace Git status",
      content: JSON.stringify(result),
    },
  ];
}
