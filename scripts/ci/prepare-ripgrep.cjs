const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Existing @vscode/ripgrep 1.15.9 postinstall checks this cache before calling
// the GitHub API. Download public release assets directly, without credentials.
const assets = {
  "darwin-arm64": [
    "aarch64-apple-darwin.tar.gz",
    "de44338ca53677968bdd7403ddc1cf9c735e708f7b63e3b34367f9411010a7db",
  ],
  "linux-x64": [
    "x86_64-unknown-linux-musl.tar.gz",
    "ef820a62c1d6fdc396646762ff0f0e47e127947073ed8b5aa4ceea8b61cb1659",
  ],
  "win32-x64": [
    "x86_64-pc-windows-msvc.zip",
    "7b35b95cf3d7f92d8fe087006899617b1b5a6dac4bbed5d4f6ace6f0934799dc",
  ],
};
function verifyAsset(bytes, expected) {
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Ripgrep release checksum mismatch");
}
async function prepareRipgrep() {
  const lock = JSON.parse(
    fs.readFileSync("extensions/vscode/package-lock.json", "utf8"),
  );
  if (lock.packages["node_modules/@vscode/ripgrep"]?.version !== "1.15.9")
    throw new Error(
      "Update and review the ripgrep download pins for the new package version",
    );
  const asset = assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error("Unsupported CI ripgrep platform");
  const [suffix, checksum] = asset;
  const name = `ripgrep-v13.0.0-10-${suffix}`;
  const directory = path.join(os.tmpdir(), "vscode-ripgrep-cache-1.15.9");
  fs.mkdirSync(directory, { recursive: true });
  const response = await fetch(
    `https://github.com/microsoft/ripgrep-prebuilt/releases/download/v13.0.0-10/${name}`,
    { signal: AbortSignal.timeout(60000) },
  );
  if (!response.ok)
    throw new Error(`Ripgrep release download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyAsset(bytes, checksum);
  fs.writeFileSync(path.join(directory, name), bytes);
  console.log(`Verified ripgrep cache for ${process.platform}-${process.arch}`);
}
if (require.main === module)
  prepareRipgrep().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { verifyAsset, assets };
