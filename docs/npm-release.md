# npm Release Guide

AIWiki is distributed as a Node.js CLI package. The package includes the compiled
`dist/` files and exposes the `aiwiki` binary.

## Current Registry Package

- Public package: `@superwoererte/aiwiki`
- Installed binary: `aiwiki`
- First published version: `0.1.0` on 2026-05-02

The unscoped `aiwiki` package name is not used because npm blocks it as too
similar to the existing `ai-wiki` package. Keep package installation examples
scoped, but keep command examples as `aiwiki`.

## Supported Runtime

- Node.js `20.x`, `22.x`, or `24.x`.
- npm 10 or newer is recommended.
- SQLite indexing is a core feature and is provided by `better-sqlite3`.

`better-sqlite3` ships native binaries for common platforms. The release smoke
workflow installs AIWiki from the packed tarball on macOS, Windows, and Linux
across the supported Node.js versions, then runs `aiwiki index build` so SQLite
support is verified before release.

npm may print a `prebuild-install` deprecation warning while installing
`better-sqlite3`. Treat that warning as non-blocking when the install completes,
`aiwiki --version` works, and `aiwiki index build` succeeds.

## Pre-Release Checklist

Before publishing, confirm:

- The npm package name is `@superwoererte/aiwiki`. The unscoped `aiwiki` name is
  blocked by npm because it is too similar to the existing `ai-wiki` package.
  Keep the binary name as `aiwiki`.
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
npm install /tmp/aiwiki-pack-smoke/*.tgz
npx aiwiki --version
npx aiwiki init --project-name smoke
npx aiwiki index build
npx aiwiki search smoke --index
```

## Publish a Beta

```bash
npm login --auth-type=web
npm version prerelease --preid beta
npm publish --tag beta --access public
```

Users can install the beta with:

```bash
npm install -g @superwoererte/aiwiki@beta
```

## Publish Stable

```bash
npm login --auth-type=web
npm version patch
npm publish --access public
```

Users can install the stable release with:

```bash
npm install -g @superwoererte/aiwiki
```

## After Publishing

Verify the registry install from a clean directory:

```bash
mkdir -p /tmp/aiwiki-registry-smoke
cd /tmp/aiwiki-registry-smoke
npm init -y
npm install @superwoererte/aiwiki@latest
npx aiwiki --version
npx aiwiki init --project-name registry-smoke
npx aiwiki index build
```

If a bad version is published, prefer deprecating it with a clear message and
shipping a fixed patch version instead of unpublishing.
