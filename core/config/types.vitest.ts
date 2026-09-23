import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

import { getConfigTsPath, getContinueGlobalPath } from "../util/paths";

it("generated configuration typings expose Git status enablement as an optional boolean", () => {
  const root = getContinueGlobalPath();
  const previousFiles = [
    path.join(root, "config.ts"),
    path.join(root, "package.json"),
    path.join(root, "types", "core", "index.d.ts"),
  ].map((filename) => ({
    filename,
    contents: fs.existsSync(filename) ? fs.readFileSync(filename) : undefined,
  }));
  const configPath = getConfigTsPath();
  const declarationPath = path.join(
    path.dirname(configPath),
    "types",
    "core",
    "index.d.ts",
  );
  const consumerPath = path.join(
    path.dirname(configPath),
    "git-status-types-check.ts",
  );
  fs.writeFileSync(
    consumerPath,
    `
    type Setting = Pick<IdeSettings, "enableGitStatusTool">;
    const omitted: Setting = {};
    const enabled: Setting = { enableGitStatusTool: true };
    const disabled: Setting = { enableGitStatusTool: false };
    // @ts-expect-error Enablement must not accept a string.
    const invalid: Setting = { enableGitStatusTool: "true" };
    export {};
  `,
  );
  try {
    const program = ts.createProgram([declarationPath, consumerPath], {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
    });
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        ),
    ).toEqual([]);
  } finally {
    fs.unlinkSync(consumerPath);
    // The global test directory is shared across suites. Do not leave a new
    // config.ts or replace pre-existing generated declarations for later tests.
    for (const { filename, contents } of previousFiles) {
      if (contents === undefined) fs.unlinkSync(filename);
      else fs.writeFileSync(filename, contents);
    }
  }
});
