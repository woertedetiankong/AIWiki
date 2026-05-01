# npm Release Guide

AIWiki is distributed as a Node.js CLI package. The package includes the compiled
`dist/` files and exposes the `aiwiki` binary.

## Supported Runtime

- Node.js `20.x`, `22.x`, or `24.x`.
- npm 10 or newer is recommended.
- SQLite indexing is a core feature and is provided by `better-sqlite3`.

`better-sqlite3` ships native binaries for common platforms. The release smoke
workflow installs AIWiki from the packed tarball on macOS, Windows, and Linux
across the supported Node.js versions, then runs `aiwiki index build` so SQLite
support is verified before release.

## Pre-Release Checklist

Before publishing, confirm:

- The package name is available to the npm account. If `aiwiki` cannot be
  published because npm still reserves a previously unpublished name, publish a
  scoped package such as `@woertedetiankong/aiwiki` while keeping the binary name
  as `aiwiki`.
- The project license has been chosen and added to `package.json` and a
  repository `LICENSE` file.
- The release smoke GitHub Action is green.
- `CHANGELOG.md` describes the user-facing changes.

Run the local release check:

```bash
npm run release:check
```

The check runs typecheck, tests, build, and `npm pack --dry-run`.

## Local Tarball Smoke Test

Use this before publishing a beta or stable version:

```bash
npm pack --pack-destination /tmp/aiwiki-pack-smoke
mkdir -p /tmp/aiwiki-install-smoke
cd /tmp/aiwiki-install-smoke
npm init -y
npm install /tmp/aiwiki-pack-smoke/aiwiki-*.tgz
npx aiwiki --version
npx aiwiki init --project-name smoke
npx aiwiki index build
npx aiwiki search smoke --index
```

## Publish a Beta

```bash
npm login
npm version prerelease --preid beta
npm publish --tag beta --access public
```

Users can install the beta with:

```bash
npm install -g aiwiki@beta
```

## Publish Stable

```bash
npm login
npm version patch
npm publish --access public
```

Users can install the stable release with:

```bash
npm install -g aiwiki
```

## After Publishing

Verify the registry install from a clean directory:

```bash
mkdir -p /tmp/aiwiki-registry-smoke
cd /tmp/aiwiki-registry-smoke
npm init -y
npm install aiwiki@latest
npx aiwiki --version
npx aiwiki init --project-name registry-smoke
npx aiwiki index build
```

If a bad version is published, prefer deprecating it with a clear message and
shipping a fixed patch version instead of unpublishing.
