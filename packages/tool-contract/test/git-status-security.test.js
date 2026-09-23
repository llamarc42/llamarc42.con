import assert from "node:assert/strict";
import cp from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  executeGitStatus,
  parseStatus,
  readGitStatus,
} from "../src/git-status.js";
import { inside } from "../src/git-status-runtime.js";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "git-status-security-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "checkout");
  mkdirSync(workspace);
  const git = (...args) =>
    cp.execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
  git("init");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgSign", "false");
  git("config", "core.autocrlf", "false");
  writeFileSync(path.join(workspace, "tracked.txt"), "original\n");
  writeFileSync(
    path.join(workspace, ".gitattributes"),
    "tracked.txt filter=Proof\n",
  );
  git("add", ".");
  git("commit", "-m", "fixture");
  const invoke = () =>
    executeGitStatus({
      args: {},
      enabled: true,
      workspace,
      invocationId: "security-test",
    });
  return { root, workspace, git, invoke };
}

function environment(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function replaceSpawn(t, replacement) {
  const original = cp.spawn;
  cp.spawn = replacement;
  syncBuiltinESMExports();
  t.after(() => {
    cp.spawn = original;
    syncBuiltinESMExports();
  });
  return original;
}

function modified(workspace) {
  const file = path.join(workspace, "tracked.txt");
  writeFileSync(file, "modified\n");
  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
}

test("repository executables, relative PATH entries, and external links into the checkout cannot select Git", async (t) => {
  const { root, workspace, invoke } = fixture(t);
  const fake = path.join(
    workspace,
    process.platform === "win32" ? "git.exe" : "git",
  );
  copyFileSync(process.execPath, fake);
  chmodSync(fake, 0o755);
  const link = path.join(root, "outside-link");
  symlinkSync(
    workspace,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  const key =
    Object.keys(process.env).find((name) => name.toLowerCase() === "path") ||
    "PATH";
  const hostPath = process.env[key];
  environment(
    t,
    key,
    ["", ".", workspace, link, hostPath].join(path.delimiter),
  );
  const nativeSpawn = cp.spawn;
  replaceSpawn(t, (executable, args, options) => {
    assert.ok(path.isAbsolute(executable));
    assert.notEqual(path.dirname(executable), workspace);
    return nativeSpawn(executable, args, options);
  });
  const result = await invoke();
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.ok(
    result.data.entries.some((entry) => entry.path === path.basename(fake)),
  );
  process.env[key] = ["", ".", workspace, link].join(path.delimiter);
  assert.equal((await invoke()).error.code, "prerequisite_missing");
});

test("mixed-case filesystem aliases cannot select a checkout executable", async (t) => {
  const { root, workspace, invoke } = fixture(t);
  const alias = path.join(root, "CHECKOUT");
  const caseInsensitive = existsSync(alias);
  // Case-sensitive hosts still exercise a real alias; no platform skips. The
  // macOS lane must exercise the actual case-insensitive-volume regression.
  if (process.platform === "darwin")
    assert.ok(
      caseInsensitive,
      "This regression requires a case-insensitive macOS CI volume",
    );
  if (!caseInsensitive) symlinkSync(workspace, alias, "dir");
  const filename = process.platform === "win32" ? "git.exe" : "git";
  copyFileSync(process.execPath, path.join(workspace, filename));
  chmodSync(path.join(workspace, filename), 0o755);
  const canonicalRoot = await realpath(workspace);
  const canonicalCandidate = await realpath(path.join(alias, filename));
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  const oldContains =
    !relative ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`));
  t.diagnostic(
    JSON.stringify({
      platform: process.platform,
      caseInsensitive,
      oldContains,
      canonicalRoot,
      canonicalCandidate,
    }),
  );
  assert.equal(await inside(canonicalRoot, canonicalCandidate), true);
  const key =
    Object.keys(process.env).find((name) => name.toLowerCase() === "path") ||
    "PATH";
  const hostPath = process.env[key];
  environment(t, key, [alias, hostPath].join(path.delimiter));
  assert.equal((await invoke()).status, "success");
  process.env[key] = alias;
  assert.equal((await invoke()).error?.code, "prerequisite_missing");
});

test("filesystem containment distinguishes descendants from similarly named siblings", async (t) => {
  const { root, workspace } = fixture(t);
  const sibling = path.join(root, "checkout-other");
  mkdirSync(sibling);
  assert.equal(await inside(workspace, workspace), true);
  assert.equal(
    await inside(workspace, path.join(workspace, "tracked.txt")),
    true,
  );
  assert.equal(await inside(workspace, sibling), false);
  assert.equal(await inside(workspace, root), false);
});

for (const driver of ["clean", "process"]) {
  test(`${driver} filters return an explicit error without executing repository commands`, async (t) => {
    const { workspace, git, invoke } = fixture(t);
    git(
      "config",
      `filter.Proof.${driver}`,
      "echo executed > filter-marker.txt; cat",
    );
    modified(workspace);
    const before = readFileSync(path.join(workspace, ".git", "index"));
    const result = await invoke();
    assert.equal(
      result.error?.code,
      "unsupported_repository",
      JSON.stringify(result),
    );
    assert.match(result.error.message, /content filter/);
    assert.equal(result.data, undefined);
    assert.equal(existsSync(path.join(workspace, "filter-marker.txt")), false);
    assert.deepEqual(
      readFileSync(path.join(workspace, ".git", "index")),
      before,
    );
  });
}

test("global content filters are detected without executing them", async (t) => {
  const { root, workspace, invoke } = fixture(t);
  const home = path.join(root, "home");
  mkdirSync(home);
  writeFileSync(
    path.join(home, ".gitconfig"),
    '[filter "Proof"]\nclean = "echo executed > filter-marker.txt; cat"\n',
  );
  environment(t, "HOME", home);
  environment(t, "USERPROFILE", home);
  environment(t, "XDG_CONFIG_HOME", home);
  modified(workspace);
  const result = await invoke();
  assert.equal(
    result.error?.code,
    "unsupported_repository",
    JSON.stringify(result),
  );
  assert.equal(existsSync(path.join(workspace, "filter-marker.txt")), false);
});

test("a config change immediately before status cannot inject filters or config includes", async (t) => {
  const { workspace, invoke } = fixture(t);
  modified(workspace);
  const nativeSpawn = cp.spawn;
  let statusStarted = false;
  replaceSpawn(t, (executable, args, options) => {
    if (args.includes("status")) {
      statusStarted = true;
      const attack =
        '[filter "Proof"]\nclean = "echo executed > filter-marker.txt; cat"\nprocess = "echo executed > process-marker.txt; cat"\n';
      const included = path.join(workspace, "included.config");
      writeFileSync(included, attack);
      appendFileSync(
        path.join(workspace, ".git", "config"),
        `\n[include]\npath = ${included.replaceAll("\\", "/")}\n${attack}`,
      );
    }
    return nativeSpawn(executable, args, options);
  });
  const result = await invoke();
  assert.equal(statusStarted, true);
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal(existsSync(path.join(workspace, "filter-marker.txt")), false);
  assert.equal(existsSync(path.join(workspace, "process-marker.txt")), false);
});

test("synchronous and asynchronous launch errors preserve identity and distinguish missing Git from failed execution", async (t) => {
  const { invoke } = fixture(t);
  for (const asynchronous of [false, true]) {
    for (const code of ["ENOENT", "EACCES", "EINVAL"]) {
      await t.test(
        `${asynchronous ? "event" : "throw"} ${code}`,
        async (subtest) => {
          let temporary;
          replaceSpawn(subtest, (_file, _args, options) => {
            temporary = options.cwd;
            const error = Object.assign(new Error(`spawn ${code}`), { code });
            if (!asynchronous) throw error;
            const child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.kill = () => true;
            queueMicrotask(() => {
              child.emit("error", error);
              child.emit("close", -1);
            });
            return child;
          });
          const result = await invoke();
          assert.equal(result.invocationId, "security-test");
          assert.equal(
            result.error.code,
            code === "ENOENT" ? "prerequisite_missing" : "spawn_failed",
          );
          assert.equal(
            result.error.message.includes("install Git"),
            code === "ENOENT",
          );
          assert.equal(existsSync(temporary), false);
        },
      );
    }
  }
});

for (const cancellation of [false, true]) {
  test(`${cancellation ? "cancellation" : "timeout"} terminates the running process and removes private metadata`, async (t) => {
    const { workspace } = fixture(t);
    const controller = new AbortController();
    let killed = false;
    let temporary;
    replaceSpawn(t, (_file, _args, options) => {
      temporary = options.cwd;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        assert.equal(signal, "SIGKILL");
        killed = true;
        queueMicrotask(() => child.emit("close", null));
        return true;
      };
      if (cancellation) queueMicrotask(() => controller.abort());
      return child;
    });
    await assert.rejects(
      readGitStatus(
        workspace,
        { timeoutMs: cancellation ? 10000 : 1000, maxOutputBytes: 65536 },
        controller.signal,
      ),
      { code: cancellation ? "cancelled" : "timeout" },
    );
    assert.equal(killed, true);
    assert.equal(existsSync(temporary), false);
  });
}

test("isolated status preserves linked-worktree results and leaves its index unchanged", async (t) => {
  const { root, git } = fixture(t);
  const worktree = path.join(root, "linked");
  git("worktree", "add", "-b", "linked", worktree);
  modified(worktree);
  const index = cp
    .execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-path", "index"],
      { cwd: worktree, encoding: "utf8" },
    )
    .trim();
  const before = readFileSync(index);
  const expected = parseStatus(
    cp.execFileSync(
      "git",
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=all",
      ],
      { cwd: worktree },
    ),
  );
  const result = await executeGitStatus({
    args: {},
    enabled: true,
    workspace: worktree,
  });
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(result.data, expected);
  assert.deepEqual(readFileSync(index), before);
});

test("split indexes are rejected explicitly rather than reported as clean", async (t) => {
  const { git, invoke } = fixture(t);
  git("update-index", "--split-index");
  const result = await invoke();
  assert.equal(
    result.error?.code,
    "unsupported_repository",
    JSON.stringify(result),
  );
  assert.match(result.error.message, /[Ss]plit indexes/);
});

test("filter names cannot inject a command through Git's inline config syntax", async (t) => {
  const { workspace, invoke } = fixture(t);
  appendFileSync(
    path.join(workspace, ".git", "config"),
    '\n[filter "Proof.clean=echo injected"]\nrequired = true\n',
  );
  modified(workspace);
  const result = await invoke();
  assert.equal(
    result.error?.code,
    "unsupported_repository",
    JSON.stringify(result),
  );
  assert.match(result.error.message, /filter name/);
});

test("unborn branches return their staged and untracked paths", async (t) => {
  const { root } = fixture(t);
  const workspace = path.join(root, "unborn");
  mkdirSync(workspace);
  const git = (...args) =>
    cp.execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
  git("init");
  writeFileSync(path.join(workspace, "staged.txt"), "staged\n");
  git("add", "staged.txt");
  writeFileSync(path.join(workspace, "untracked.txt"), "untracked\n");
  const result = await executeGitStatus({ args: {}, enabled: true, workspace });
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(
    result.data,
    parseStatus(
      git(
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ),
    ),
  );
});

test("SHA-256 repositories retain their object format in the isolated snapshot", async (t) => {
  const { root } = fixture(t);
  const workspace = path.join(root, "sha256");
  mkdirSync(workspace);
  const git = (...args) =>
    cp.execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
  git("init", "--object-format=sha256");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgSign", "false");
  writeFileSync(path.join(workspace, "tracked.txt"), "original\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  modified(workspace);
  const result = await executeGitStatus({ args: {}, enabled: true, workspace });
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(
    result.data,
    parseStatus(git("--no-optional-locks", "status", "--porcelain=v1", "-z")),
  );
});

test("attributes and ignore rules retain native semantics while fsmonitor stays disabled", async (t) => {
  const { workspace, git, invoke } = fixture(t);
  writeFileSync(
    path.join(workspace, ".git", "info", "exclude"),
    "ignored.txt\n",
  );
  writeFileSync(
    path.join(workspace, ".git", "info", "attributes"),
    "tracked.txt text eol=lf\n",
  );
  writeFileSync(path.join(workspace, "tracked.txt"), "original\r\n");
  writeFileSync(path.join(workspace, "ignored.txt"), "ignored\n");
  const expected = parseStatus(
    git("--no-optional-locks", "status", "--porcelain=v1", "-z"),
  );
  const marker = path.join(workspace, "monitor-marker.txt");
  const hook = path.join(workspace, ".git", "monitor.sh");
  writeFileSync(hook, "#!/bin/sh\necho executed > monitor-marker.txt\n");
  chmodSync(hook, 0o755);
  git("config", "core.fsmonitor", hook.replaceAll("\\", "/"));
  const result = await invoke();
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.deepEqual(result.data, expected);
  assert.equal(existsSync(marker), false);
});

test("sparse and partial clone configurations return explicit unsupported errors", async (t) => {
  const { git, invoke } = fixture(t);
  git("config", "core.sparseCheckout", "true");
  assert.equal((await invoke()).error?.code, "unsupported_repository");
  git("config", "--unset", "core.sparseCheckout");
  git("config", "remote.origin.promisor", "true");
  assert.equal((await invoke()).error?.code, "unsupported_repository");
});
