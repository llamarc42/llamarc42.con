import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import definition from "../manifests/git-status.json" with { type: "json" };
import { ContractError, createRegistry } from "./index.js";

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

// No shell, user arguments, hooks, fsmonitor, optional index writes, or submodule
// child processes. Git itself emits slash-separated, NUL-delimited paths.
export async function readGitStatus(workspace, limits, signal) {
  const cwd = await realpath(workspace).catch(() => {
    throw new ContractError("tool_failed", "Workspace is unavailable");
  });
  await access(path.join(cwd, ".git")).catch(() => {
    throw new ContractError(
      "tool_failed",
      "Open the repository root as your workspace",
    );
  });
  if (signal?.aborted)
    throw new ContractError("cancelled", "Invocation cancelled");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  });
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "--work-tree=.",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=all",
      ],
      {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const chunks = [];
    let bytes = 0;
    let failure;
    const stop = (code) => {
      failure ??= new ContractError(code, "Git status did not complete");
      child.kill("SIGKILL");
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), limits.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const consume = (chunk, stdout) => {
      bytes += chunk.length;
      if (bytes > limits.maxOutputBytes) stop("output_limit_exceeded");
      else if (stdout && !failure) chunks.push(chunk);
    };
    child.stdout.on("data", (chunk) => consume(chunk, true));
    child.stderr.on("data", (chunk) => consume(chunk, false));
    child.on("error", (error) => {
      failure ??= new ContractError(
        error.code === "ENOENT" ? "prerequisite_missing" : "spawn_failed",
        "Git could not be started; install Git and restart the editor",
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new ContractError("tool_failed", "Git status failed"));
      else resolve(Buffer.concat(chunks));
    });
  });
  return parseStatus(output);
}

/** @param {{args: unknown, workspace: string, enabled: boolean, signal?: AbortSignal, invocationId?: string}} options */
export async function executeGitStatus({
  args,
  workspace,
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
    const data = registry.validateResult(
      manifest.id,
      await readGitStatus(workspace, manifest.limits, signal),
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
      error: { code, message: error.message },
      complete: false,
      durationMs: performance.now() - started,
    };
  }
}
