import { randomUUID } from "node:crypto";
import definition from "../manifests/git-status.json" with { type: "json" };
import { ContractError, createRegistry } from "./index.js";
import { statusBytes } from "./git-status-runtime.js";

export function gitStatusRegistry(enabled = false) {
  const registry = createRegistry([
    { id: "git.status", effects: ["workspace.read", "process.execute"] },
  ]);
  const manifest = registry.register(JSON.stringify(definition));
  registry.setEnabled(manifest.id, enabled);
  return { registry, manifest };
}

export function parseStatus(buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ContractError("invalid_result", "Git returned a non-UTF-8 path");
  }
  if (text && !text.endsWith("\0"))
    throw new ContractError("invalid_result", "Incomplete Git status record");
  const records = text ? text.slice(0, -1).split("\0") : [];
  const entries = [];
  const checkPath = (value) => {
    if (!value || value.startsWith("/") || value.split("/").includes(".."))
      throw new ContractError(
        "invalid_result",
        "Invalid repository-relative path",
      );
    return value;
  };
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!/^[ MTADRCU?!]{2} /.test(record))
      throw new ContractError("invalid_result", "Invalid Git status record");
    const entry = {
      path: checkPath(record.slice(3)),
      indexStatus: record[0],
      worktreeStatus: record[1],
    };
    if (/[RC]/.test(record.slice(0, 2)))
      entry.originalPath = checkPath(records[++i]);
    entries.push(entry);
  }
  return { entries };
}

export async function readGitStatus(workspace, limits, signal) {
  return parseStatus(await statusBytes(workspace, limits, signal));
}

/** @param {{args: unknown, workspace?: string, resolveWorkspace?: () => Promise<string>, enabled: boolean, signal?: AbortSignal, invocationId?: string}} options */
export async function executeGitStatus({
  args,
  workspace,
  resolveWorkspace,
  enabled,
  signal,
  invocationId = randomUUID(),
}) {
  const started = performance.now();
  const { registry, manifest } = gitStatusRegistry(enabled);
  const envelope = {
    invocationId,
    toolId: manifest.id,
    version: manifest.version,
  };
  try {
    registry.validateCall(manifest.name, args);
    if (signal?.aborted)
      throw new ContractError("cancelled", "Invocation cancelled");
    const selectedWorkspace = resolveWorkspace
      ? await resolveWorkspace()
      : workspace;
    const data = registry.validateResult(
      manifest.id,
      await readGitStatus(selectedWorkspace, manifest.limits, signal),
    );
    if (
      Buffer.byteLength(JSON.stringify(data)) > manifest.limits.maxOutputBytes
    )
      throw new ContractError(
        "output_limit_exceeded",
        "Structured result exceeds limit",
      );
    return {
      ...envelope,
      status: "success",
      data,
      complete: true,
      durationMs: performance.now() - started,
    };
  } catch (error) {
    const code = error instanceof ContractError ? error.code : "tool_failed";
    return {
      ...envelope,
      status: code === "cancelled" ? "cancelled" : "error",
      error: {
        code,
        message:
          error instanceof ContractError
            ? error.message.slice(code.length + 2)
            : error.message,
      },
      complete: false,
      durationMs: performance.now() - started,
    };
  }
}
