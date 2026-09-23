import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContractError } from "./index.js";

// Callers provide existing real paths. realpath resolves links but does not
// promise case normalization on case-insensitive filesystems (notably macOS).
// Compare directory identity instead of assuming path-string casing semantics.
export async function inside(root, candidate) {
  const rootIdentity = await stat(root, { bigint: true });
  for (let current = candidate; ; current = path.dirname(current)) {
    const identity = await stat(current, { bigint: true });
    if (identity.dev === rootIdentity.dev && identity.ino === rootIdentity.ino)
      return true;
    if (path.dirname(current) === current) return false;
  }
}

function launchError(error) {
  return new ContractError(
    error.code === "ENOENT" ? "prerequisite_missing" : "spawn_failed",
    error.code === "ENOENT"
      ? "Git was not found; install Git and restart the editor"
      : `Git could not be started (${error.code || "unknown error"}); check executable permissions and installation`,
  );
}

// Only the host's absolute PATH entries are eligible. In particular, Windows'
// implicit current-directory search and relative/empty PATH entries never run.
async function findGit(workspace) {
  const searchPath =
    Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === "path",
    )?.[1] || "";
  let denied;
  for (const entry of searchPath.split(path.delimiter)) {
    if (!path.isAbsolute(entry)) continue;
    try {
      const directory = await realpath(entry);
      if (await inside(workspace, directory)) continue;
      const candidate = await realpath(
        path.join(directory, process.platform === "win32" ? "git.exe" : "git"),
      );
      if (
        (await inside(workspace, candidate)) ||
        !(await stat(candidate)).isFile()
      )
        continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") denied = error;
      else if (error.code !== "ENOENT" && error.code !== "ENOTDIR")
        throw launchError(error);
    }
  }
  throw launchError(denied || { code: "ENOENT" });
}

function runner(executable, cwd, env, limits, signal, deadline) {
  let bytes = 0;
  const check = () => {
    if (signal?.aborted)
      throw new ContractError("cancelled", "Invocation cancelled");
    if (performance.now() >= deadline)
      throw new ContractError("timeout", "Git status did not complete");
  };
  const run = async (
    args,
    extraEnv = {},
    allowedCodes = [0],
    diagnoseFilters = false,
  ) => {
    check();
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(executable, args, {
          cwd,
          env: { ...env, ...extraEnv },
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(launchError(error));
        return;
      }
      const chunks = [];
      const errors = [];
      let failure;
      const stop = (code) => {
        failure ??= new ContractError(code, "Git status did not complete");
        child.kill("SIGKILL");
      };
      const abort = () => stop("cancelled");
      const timer = setTimeout(
        () => stop("timeout"),
        Math.max(1, deadline - performance.now()),
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const consume = (chunk, stdout) => {
        bytes += chunk.length;
        if (bytes > limits.maxOutputBytes) stop("output_limit_exceeded");
        else if (!failure) (stdout ? chunks : errors).push(chunk);
      };
      child.stdout.on("data", (chunk) => consume(chunk, true));
      child.stderr.on("data", (chunk) => consume(chunk, false));
      child.on("error", (error) => {
        failure ??= launchError(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else if (!allowedCodes.includes(code)) {
          const stderr = Buffer.concat(errors).toString("utf8");
          reject(
            diagnoseFilters &&
              stderr.includes("clean filter '") &&
              stderr.includes("' failed")
              ? unsupported(
                  "Status requires a content filter, which git_status does not execute",
                )
              : new ContractError(
                  "tool_failed",
                  "Git status metadata or execution failed",
                ),
          );
        } else resolve(Buffer.concat(chunks));
      });
    });
  };
  return { run, check };
}

function unsupported(detail) {
  return new ContractError("unsupported_repository", detail);
}

// Config values are passed as individual arguments, never serialized as config
// syntax. Only settings that affect ordinary status semantics are retained.
function statusConfig(buffer) {
  const config = new Map();
  for (const record of new TextDecoder("utf-8", { fatal: true })
    .decode(buffer)
    .split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\n");
    // Git normalizes section/key case but subsection (including driver) names
    // are case-sensitive and must be preserved.
    const key = separator < 0 ? record : record.slice(0, separator);
    config.set(key, separator < 0 ? "true" : record.slice(separator + 1));
  }
  for (const key of ["core.sparsecheckout", "core.splitindex"]) {
    if (config.has(key) && !/^(false|no|off|0)$/i.test(config.get(key))) {
      throw unsupported(
        "Sparse checkouts and split indexes are not supported by git_status",
      );
    }
  }
  if (
    [...config.keys()].some(
      (key) =>
        key === "extensions.partialclone" || /^remote\..*\.promisor$/.test(key),
    )
  ) {
    throw unsupported("Partial clones are not supported by git_status");
  }
  const args = [];
  const drivers = new Set(
    [...config.keys()]
      .map((key) => /^filter\.(.+)\.[^.]+$/s.exec(key)?.[1])
      .filter(Boolean),
  );
  // Retain each driver name, but no command. Git fails closed if status needs
  // conversion instead of silently comparing raw bytes or executing a filter.
  for (const driver of drivers) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(driver))
      throw unsupported("Unsupported content filter name");
    args.push("-c", `filter.${driver}.required=true`);
  }
  for (const key of [
    "core.filemode",
    "core.ignorecase",
    "core.symlinks",
    "core.autocrlf",
    "core.eol",
    "core.checkroundtripencoding",
    "core.precomposeunicode",
    "core.attributesfile",
    "core.excludesfile",
    "status.renames",
    "status.renamelimit",
    "diff.renamelimit",
  ]) {
    if (config.has(key)) args.push("-c", `${key}=${config.get(key)}`);
  }
  return args;
}

async function copyOptional(source, destination, maximum, check) {
  let input;
  let output;
  try {
    input = await open(
      source,
      constants.O_RDONLY | (constants.O_NONBLOCK || 0),
    );
    const info = await input.stat();
    if (!info.isFile() || info.size > maximum)
      throw unsupported(
        "Repository metadata is not a regular file within the supported size limit",
      );
    output = await open(destination, "wx");
    const buffer = Buffer.alloc(Math.min(maximum + 1, 1024 * 1024));
    let total = 0;
    for (;;) {
      check();
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, maximum - total + 1),
      );
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum)
        throw unsupported(
          "Repository metadata exceeds the supported size limit",
        );
      await output.writeFile(buffer.subarray(0, bytesRead));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  } finally {
    await input?.close();
    await output?.close();
  }
}

// Metadata-only builtins inspect the original repository. Status runs against a
// private index/HEAD/config snapshot, so a config race cannot add a filter, hook,
// fsmonitor, helper, or promisor remote to the command that reads file contents.
export async function statusBytes(workspace, limits, signal) {
  const deadline = performance.now() + limits.timeoutMs;
  if (signal?.aborted)
    throw new ContractError("cancelled", "Invocation cancelled");
  const cwd = await realpath(workspace).catch(() => {
    throw new ContractError("tool_failed", "Workspace is unavailable");
  });
  await access(path.join(cwd, ".git")).catch(() => {
    throw new ContractError(
      "tool_failed",
      "Open the repository root as your workspace",
    );
  });
  const executable = await findGit(cwd);
  const temporaryRoot = await realpath(os.tmpdir());
  if (await inside(cwd, temporaryRoot))
    throw unsupported(
      "Git status requires a temporary directory outside the workspace",
    );
  const temporary = await mkdtemp(
    path.join(temporaryRoot, "llamarc42-git-status-"),
  );
  try {
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
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      LC_ALL: "C",
      LANG: "C",
    });
    const { run, check } = runner(
      executable,
      temporary,
      env,
      limits,
      signal,
      deadline,
    );
    const original = [
      "-C",
      cwd,
      "--work-tree=.",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
    ];
    // Read host defaults as data, including drivers commonly installed globally
    // (e.g. LFS). Subsequent processes cannot load those files again.
    const configArgs = statusConfig(
      await run([...original, "config", "--null", "--list", "--includes"], {
        GIT_CONFIG_NOSYSTEM: "0",
        GIT_CONFIG_GLOBAL: undefined,
      }),
    );
    const paths = (
      await run([
        ...original,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects",
        "--git-path",
        "index",
        "--git-path",
        "info/exclude",
        "--git-path",
        "info/attributes",
        "--show-object-format",
      ])
    )
      .toString("utf8")
      .trimEnd()
      .split("\n");
    if (
      paths.length !== 5 ||
      !paths.slice(0, 4).every((value) => path.isAbsolute(value)) ||
      !["sha1", "sha256"].includes(paths[4])
    )
      throw unsupported(
        "Unsupported repository metadata paths or object format",
      );
    if ((await run([...original, "rev-parse", "--shared-index-path"])).length)
      throw unsupported("Split indexes are not supported by git_status");
    const head = (
      await run(
        [...original, "rev-parse", "--verify", "--quiet", "HEAD"],
        {},
        [0, 1],
      )
    )
      .toString("ascii")
      .trim();
    if (
      head &&
      !(paths[4] === "sha256" ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/).test(head)
    )
      throw unsupported("Unsupported HEAD object identifier");
    const gitDir = path.join(temporary, "repository");
    await mkdir(path.join(gitDir, "refs"), { recursive: true });
    await mkdir(path.join(gitDir, "info"));
    await writeFile(
      path.join(gitDir, "HEAD"),
      head ? `${head}\n` : "ref: refs/heads/unborn\n",
    );
    await writeFile(
      path.join(gitDir, "config"),
      paths[4] === "sha256"
        ? "[core]\nrepositoryformatversion = 1\n[extensions]\nobjectformat = sha256\n"
        : "[core]\nrepositoryformatversion = 0\n",
    );
    await copyOptional(
      paths[1],
      path.join(gitDir, "index"),
      128 * 1024 * 1024,
      check,
    );
    await copyOptional(
      paths[2],
      path.join(gitDir, "info", "exclude"),
      limits.maxOutputBytes,
      check,
    );
    await copyOptional(
      paths[3],
      path.join(gitDir, "info", "attributes"),
      limits.maxOutputBytes,
      check,
    );
    check();
    return await run(
      [
        "-C",
        cwd,
        "--git-dir",
        gitDir,
        "--work-tree",
        cwd,
        ...configArgs,
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
      { GIT_OBJECT_DIRECTORY: paths[0] },
      [0],
      true,
    );
  } finally {
    // This path is generated directly below a verified external temporary root.
    await rm(temporary, { recursive: true, force: true });
  }
}
