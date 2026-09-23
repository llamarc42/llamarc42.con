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
    // Preserve invalid input for contract validation instead of repairing it.
    return undefined;
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
  const result = await executeGitStatus({
    args,
    resolveWorkspace: async () => {
      if (await extras.ide.isWorkspaceRemote())
        throw new Error(
          "Git status requires a local workspace; remote execution is not connected yet",
        );
      const roots = await extras.ide.getWorkspaceDirs();
      if (roots.length !== 1)
        throw new Error("Git status requires exactly one workspace repository");
      try {
        return fileURLToPath(roots[0]);
      } catch {
        throw new Error(
          "Workspace must be accessible to the extension host as a file URI",
        );
      }
    },
    // Recheck even old calls, with settings failures inside the result envelope.
    enabled: async () =>
      (await extras.ide.getIdeSettings()).enableGitStatusTool === true,
    signal: undefined,
    invocationId: extras.toolCallId,
  });
  return [
    {
      name: "Git status",
      description: "Workspace Git status",
      content: JSON.stringify(result),
    },
  ];
}
