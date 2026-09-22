const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function validateLockfiles(changed, root = process.cwd()) {
  const manifests = new Set(
    changed
      .filter((file) => /(^|\/)package(-lock)?\.json$/.test(file))
      .map((file) => file.replace(/package-lock\.json$/, "package.json")),
  );
  for (const file of manifests) {
    const manifestPath = resolve(root, file);
    const lockPath = resolve(
      root,
      file.replace(/package\.json$/, "package-lock.json"),
    );
    // Removing a whole package is valid; removing only its lockfile is not.
    if (!existsSync(manifestPath) && !existsSync(lockPath)) continue;
    if (!existsSync(manifestPath) || !existsSync(lockPath))
      throw new Error(`${file}: missing manifest or lockfile`);
    const manifest = JSON.parse(readFileSync(manifestPath));
    const lock = JSON.parse(readFileSync(lockPath)).packages?.[""];
    if (!lock) throw new Error(`${file}: missing lockfile root package`);
    for (const key of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "version",
    ]) {
      const normalize = (value) =>
        value && typeof value === "object"
          ? Object.entries(value).sort()
          : value;
      if (
        JSON.stringify(normalize(manifest[key])) !==
        JSON.stringify(normalize(lock[key]))
      )
        throw new Error(`${file}: lockfile differs in ${key}`);
    }
  }
}
module.exports = { validateLockfiles };
