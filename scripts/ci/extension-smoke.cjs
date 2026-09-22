const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { runTests } = require("@vscode/test-electron");
const AdmZip = require("adm-zip");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llamarc42-ci-"));
  const workspace = path.join(root, "workspace");
  const configDir = path.join(root, "continue");
  fs.mkdirSync(workspace);
  fs.mkdirSync(configDir);
  fs.writeFileSync(
    path.join(workspace, "README.md"),
    "Fixture token: L42-CI-CONTINUATION\n",
  );
  const target = `${process.platform}-${process.arch}`;
  const { version } = JSON.parse(
    fs.readFileSync("extensions/vscode/package.json", "utf8"),
  );
  const artifact = path.resolve(
    `extensions/vscode/build/continue-${target}-${version}.vsix`,
  );
  const zip = new AdmZip(artifact);
  for (const name of [
    "extension/package.json",
    "extension/out/extension.js",
    "extension/gui/index.html",
    "extension/config-yaml-schema.json",
    "extension/config_schema.json",
    "extension/continue_rc_schema.json",
    "extension/out/build/Release/node_sqlite3.node",
  ]) {
    assert.ok(
      zip.getEntry(name)?.header.size > 0,
      `Missing artifact entry ${name}`,
    );
  }
  zip.extractAllTo(path.join(root, "package"));
  let round = 0;
  let failure;
  const server = http.createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const data = body ? JSON.parse(body) : {};
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/show") {
        response.end(
          JSON.stringify({
            capabilities: ["completion", "tools"],
            parameters: "",
            template: "",
            details: { family: "qwen3" },
            model_info: {
              "general.architecture": "qwen3",
              "qwen3.context_length": 8192,
            },
          }),
        );
      } else if (request.url === "/api/tags") {
        response.end(JSON.stringify({ models: [{ name: "qwen3-coder:30b" }] }));
      } else if (request.url === "/api/chat") {
        assert.deepEqual(data.tools.map((tool) => tool.function.name).sort(), [
          "ls",
          "read_file",
        ]);
        let message;
        if (round === 0)
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "ls",
                  arguments: { dirPath: ".", recursive: false },
                },
              },
            ],
          };
        else if (round === 1) {
          assert.equal(data.messages.at(-1).role, "tool");
          message = {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "read_file",
                  arguments: { filepath: "README.md" },
                },
              },
            ],
          };
        } else {
          assert.equal(round, 2);
          assert.ok(
            data.messages.at(-1).content.includes("L42-CI-CONTINUATION"),
          );
          message = { role: "assistant", content: "L42-CI-CONTINUATION" };
        }
        round++;
        response.end(JSON.stringify({ message, done: true }) + "\n");
      } else {
        response.statusCode = 404;
        response.end("{}");
      }
    } catch (error) {
      failure = error;
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(
    path.join(configDir, "config.yaml"),
    `name: CI\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: CI mock\n    provider: ollama\n    model: qwen3-coder:30b\n    apiBase: http://127.0.0.1:${server.address().port}\n    roles: [chat]\n    capabilities: [tool_use]\n`,
  );
  try {
    await runTests({
      version: "1.95.0",
      extensionDevelopmentPath: path.join(root, "package", "extension"),
      extensionTestsPath: path.resolve("scripts/ci/extension-test.cjs"),
      extensionTestsEnv: {
        CONTINUE_GLOBAL_DIR: configDir,
        NODE_ENV: "production",
      },
      launchArgs: [
        workspace,
        "--user-data-dir",
        path.join(root, "user-data"),
        "--extensions-dir",
        path.join(root, "extensions"),
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-telemetry",
        "--disable-workspace-trust",
        "--no-sandbox",
      ],
    });
    if (failure) throw failure;
    assert.equal(
      round,
      3,
      "All continuation rounds must reach the mock server",
    );
    console.log(
      "Packaged extension activation and list/read/answer continuation passed",
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
