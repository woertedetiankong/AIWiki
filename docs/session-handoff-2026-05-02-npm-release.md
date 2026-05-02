# Session Handoff: npm Release

Date: 2026-05-02

## Current Status

AIWiki has its first public npm release:

- Package: `@superwoererte/aiwiki`
- Version: `0.1.0`
- Binary: `aiwiki`
- License: MIT
- Repository branch: `main`

The unscoped package name `aiwiki` cannot be used because npm blocks it as too
similar to the existing `ai-wiki` package. Keep user install commands scoped,
but keep command examples as `aiwiki`.

## Validation

Local release checks passed before publishing:

```bash
npm publish --dry-run --access public
```

That command ran `prepublishOnly`, which runs:

```bash
npm run typecheck
npm run test
npm run build
npm run pack:dry-run
```

GitHub Release Smoke passed after the scoped tarball fix:

- macOS, Windows, and Linux
- Node.js 20, 22, and 24
- tarball install
- `aiwiki index build`

Registry smoke passed from a clean directory:

```bash
npm install @superwoererte/aiwiki@latest
npx aiwiki --version
npx aiwiki init --project-name registry-smoke
npx aiwiki index build
```

## Install Guidance

Users install the package with:

```bash
npm install -g @superwoererte/aiwiki
```

Then run:

```bash
aiwiki --version
aiwiki init --project-name my-project
```

npm may print this warning while installing:

```text
npm warn deprecated prebuild-install@7.1.3: No longer maintained.
```

This warning currently comes from the native SQLite dependency path used by
`better-sqlite3`. It is acceptable when install completes, `aiwiki --version`
works, and `aiwiki index build` succeeds.

## Follow-Up Work

- Keep SQLite indexing as a core feature for now.
- Watch future `better-sqlite3` releases and native install behavior.
- Consider friendlier install troubleshooting docs if users report native
  dependency failures.
- Do not make SQLite optional unless there is a concrete user install problem
  that outweighs the current index feature value.

