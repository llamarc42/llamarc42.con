import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  renameSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeGitStatus,
  gitStatusRegistry,
  parseStatus,
  readGitStatus,
} from "../src/git-status.js";

function repository(t) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "git-status-test-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
  git("init");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(workspace, "tracked.txt"), "original\n");
  writeFileSync(path.join(workspace, "rename.txt"), "rename\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  return { workspace, git };
}

test("production manifest is disabled by default and exposes only model fields", () => {
  assert.deepEqual(gitStatusRegistry().registry.definitions(), []);
  const definition = gitStatusRegistry(true).registry.definitions()[0];
  assert.deepEqual(Object.keys(definition).sort(), ["function", "type"]);
  assert.equal(definition.function.name, "git_status");
});

test("native Git returns clean, modified, untracked Unicode, and staged rename results", async (t) => {
  const { workspace, git } = repository(t);
  const invoke = () => executeGitStatus({ args: {}, workspace, enabled: true });
  assert.deepEqual((await invoke()).data, { entries: [] });
  writeFileSync(path.join(workspace, "tracked.txt"), "modified\n");
  mkdirSync(path.join(workspace, "nested"));
  writeFileSync(path.join(workspace, "nested", "café file.txt"), "new\n");
  renameSync(
    path.join(workspace, "rename.txt"),
    path.join(workspace, "renamed file.txt"),
  );
  git("add", "rename.txt", "renamed file.txt");
  const result = await invoke();
  assert.equal(result.status, "success");
  assert.equal(result.complete, true);
  assert.ok(result.invocationId);
  assert.deepEqual(result.data.entries, [
    {
      path: "renamed file.txt",
      originalPath: "rename.txt",
      indexStatus: "R",
      worktreeStatus: " ",
    },
    { path: "tracked.txt", indexStatus: " ", worktreeStatus: "M" },
    { path: "nested/café file.txt", indexStatus: "?", worktreeStatus: "?" },
  ]);
});

test("disabled calls and invalid arguments fail before touching the workspace", async () => {
  for (const [enabled, args, code] of [
    [false, {}, "tool_disabled"],
    [true, { command: "anything" }, "invalid_arguments"],
    [true, null, "invalid_arguments"],
    [true, [], "invalid_arguments"],
  ]) {
    const result = await executeGitStatus({
      workspace: "nonexistent",
      enabled,
      args,
    });
    assert.equal(result.error.code, code);
    assert.equal(result.complete, false);
    assert.equal(result.data, undefined);
  }
});

test("nested workspace never falls back to a parent repository", async (t) => {
  const { workspace } = repository(t);
  const nested = path.join(workspace, "nested");
  mkdirSync(nested);
  assert.equal(
    (await executeGitStatus({ args: {}, enabled: true, workspace: nested }))
      .error.code,
    "tool_failed",
  );
});

test("output overflow returns no partial result; pre-cancelled invocation never starts Git", async (t) => {
  const { workspace } = repository(t);
  writeFileSync(path.join(workspace, "new.txt"), "new");
  await assert.rejects(
    readGitStatus(workspace, { timeoutMs: 10000, maxOutputBytes: 1 }),
    { code: "output_limit_exceeded" },
  );
  const controller = new AbortController();
  controller.abort();
  const result = await executeGitStatus({
    args: {},
    enabled: true,
    workspace,
    signal: controller.signal,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.code, "cancelled");
});

test("parser preserves NUL-delimited filenames and rejects broken records", () => {
  assert.equal(
    parseStatus(Buffer.from(" T link\0")).entries[0].worktreeStatus,
    "T",
  );
  assert.deepEqual(
    parseStatus(Buffer.from("?? line\nname.txt\0")).entries[0].path,
    "line\nname.txt",
  );
  for (const bytes of [
    Buffer.from("?? unfinished"),
    Buffer.from("R  missing-source\0"),
    Buffer.from([63, 63, 32, 255, 0]),
  ]) {
    assert.throws(() => parseStatus(bytes), { code: "invalid_result" });
  }
});

test("missing Git returns a portable prerequisite error", async (t) => {
  const { workspace } = repository(t);
  const key =
    Object.keys(process.env).find((name) => name.toLowerCase() === "path") ||
    "PATH";
  const previous = process.env[key];
  process.env[key] = "";
  try {
    const result = await executeGitStatus({
      args: {},
      enabled: true,
      workspace,
    });
    assert.equal(result.error.code, "prerequisite_missing");
    assert.equal(result.data, undefined);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("repository configuration cannot redirect status outside the selected workspace", async (t) => {
  const { workspace, git } = repository(t);
  const outside = mkdtempSync(path.join(os.tmpdir(), "git-status-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, "outside.txt"), "outside");
  git("config", "core.worktree", outside);
  const result = await executeGitStatus({ args: {}, enabled: true, workspace });
  assert.equal(result.status, "success");
  assert.deepEqual(result.data.entries, []);
});

test("repository shell aliases cannot shadow the built-in status command", async (t) => {
  const { workspace, git } = repository(t);
  git("config", "alias.status", "!echo executed > alias-executed.txt");
  const result = await executeGitStatus({ args: {}, enabled: true, workspace });
  assert.equal(result.status, "success");
  assert.deepEqual(result.data.entries, []);
  assert.equal(existsSync(path.join(workspace, "alias-executed.txt")), false);
});

test("pre-cancelled calls do not resolve or access even a missing workspace", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await executeGitStatus({
    args: {},
    enabled: true,
    signal: controller.signal,
    resolveWorkspace: async () => {
      assert.fail("workspace must not be resolved");
    },
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.code, "cancelled");
  await assert.rejects(
    readGitStatus(
      "nonexistent",
      { timeoutMs: 10000, maxOutputBytes: 65536 },
      controller.signal,
    ),
    { code: "cancelled" },
  );
});

test("workspace resolution failures retain envelope identity and a single error code", async () => {
  const result = await executeGitStatus({
    args: {},
    enabled: true,
    invocationId: "host-error",
    resolveWorkspace: async () => {
      throw new Error("Workspace unavailable");
    },
  });
  assert.equal(result.invocationId, "host-error");
  assert.deepEqual(result.error, {
    code: "tool_failed",
    message: "Workspace unavailable",
  });
  const invalid = await executeGitStatus({
    args: null,
    enabled: true,
    resolveWorkspace: async () => {
      assert.fail("invalid args must not resolve workspace");
    },
  });
  assert.equal(invalid.error.code, "invalid_arguments");
  assert.equal(invalid.error.message.includes("invalid_arguments:"), false);
});
