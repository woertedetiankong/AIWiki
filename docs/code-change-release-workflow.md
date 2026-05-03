# 修改代码后的发包流程

这份文档记录 AIWiki 后续每次修改代码后，如何把新版本发布到 npm，并同步到 GitHub。

当前 npm 包名是 `@superwoererte/aiwiki`，安装后的命令仍然是 `aiwiki`。

## 什么时候需要发包

只改 GitHub 代码，不会自动影响 npm 用户。

如果希望用户运行下面命令时拿到新代码，就需要发布一个新的 npm 版本：

```bash
npm install -g @superwoererte/aiwiki
```

如果只是本机临时测试，可以不发 npm，直接在仓库里运行：

```bash
npm install -g .
aiwiki --version
```

## 推荐发布顺序

### 1. 确认工作区状态

```bash
git status -sb
git pull --ff-only origin main
```

如果有未提交的代码改动，先正常测试、提交、推送代码。发布版本号改动最好单独提交，方便以后回溯。

### 2. 发布前先跑检查

```bash
npm run release:check
```

这个命令会依次运行：

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run pack:dry-run`

只有它通过，才继续发包。

### 3. 决定版本号

常见情况：

- `patch`：bugfix、文档修正、小的兼容改进，例如 `0.1.2` -> `0.1.3`
- `minor`：新增命令、新功能，但不破坏旧用法，例如 `0.1.2` -> `0.2.0`
- `major`：破坏性变更，例如 `0.1.2` -> `1.0.0`

大多数日常修复用 `patch`。

### 4. 安全地 bump 版本

推荐先只改文件，不自动创建 git tag：

```bash
npm version patch --no-git-tag-version
```

如果要发 minor 或 major，对应使用：

```bash
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
```

然后把 `src/constants.ts` 里的 `AIWIKI_VERSION` 改成和 `package.json` 完全一样的版本。

检查当前包版本：

```bash
node -p "require('./package.json').version"
```

检查 CLI 输出版本：

```bash
npm run dev:aiwiki -- --version
```

两者必须一致。这个项目有测试会检查这件事；如果不一致，`npm publish` 前的 `prepublishOnly` 会失败。

### 5. 再跑一次发布检查

```bash
npm run release:check
```

如果失败，先修复失败原因。不要因为发布失败就再次运行 `npm version patch`，否则版本号会多跳一次。

### 6. 提交版本号并打 tag

假设新版本是 `0.1.3`：

```bash
git add package.json package-lock.json src/constants.ts
git commit -m "chore: release 0.1.3"
git tag v0.1.3
```

如果这次版本还有配套文档更新，也一起加入这个提交。

### 7. 登录 npm

```bash
npm login --auth-type=web
npm whoami
```

`npm whoami` 应该输出有发布权限的账号，例如：

```text
superwoererte
```

### 8. 发布到 npm

```bash
npm publish --access public
```

如果 npm 要求一次性验证码，可以按网页提示完成验证，或者使用：

```bash
npm publish --access public --otp 你的验证码
```

发布成功时会看到类似：

```text
+ @superwoererte/aiwiki@0.1.3
```

### 9. 验证 npm latest

```bash
npm view @superwoererte/aiwiki version
npm view @superwoererte/aiwiki dist-tags --json
```

期望 `version` 和 `latest` 都是刚发布的新版本。

刚发布后的几秒到一两分钟内，npm 可能还显示旧版本。这通常是 registry 缓存延迟。可以再查：

```bash
npm view @superwoererte/aiwiki versions --json
npm view @superwoererte/aiwiki@0.1.3 version
```

如果 `versions` 里已经有新版本，通常等一会儿 `latest` 就会同步。

### 10. 推送 GitHub main 和 tag

npm 发布成功后，再把对应提交和 tag 推到 GitHub：

```bash
git push origin main --tags
```

这个命令会同时推送：

- `main` 分支上的版本提交
- `v0.1.3` 这样的发布 tag

这样以后可以清楚地知道 npm 上的版本对应 GitHub 哪一份代码。

### 11. 从 registry 做一次干净安装验证

```bash
mkdir -p /tmp/aiwiki-registry-smoke
cd /tmp/aiwiki-registry-smoke
npm init -y
npm install @superwoererte/aiwiki@latest
npx aiwiki --version
npx aiwiki init --project-name registry-smoke
npx aiwiki index build
```

`npx aiwiki --version` 应该输出刚发布的新版本。

## 常见问题

### `npm publish` 前测试失败：CLI 版本不一致

错误类似：

```text
expected '0.1.2' to be '0.1.3'
```

原因是 `package.json` 已经 bump 到新版本，但 `src/constants.ts` 里的 `AIWIKI_VERSION` 还没同步。

修复：

```bash
node -p "require('./package.json').version"
# 把输出版本写入 src/constants.ts 的 AIWIKI_VERSION
npm run release:check
```

### `npm publish` 要求 OTP 或浏览器认证

这是 npm 账号安全验证。不要重新 bump 版本，直接重新运行：

```bash
npm publish --access public
```

按提示打开浏览器认证，或者加：

```bash
npm publish --access public --otp 你的验证码
```

### `npm view` 刚开始还是旧版本

如果发布输出已经出现：

```text
+ @superwoererte/aiwiki@新版本
```

但 `npm view @superwoererte/aiwiki version` 还是旧版本，通常是短暂缓存延迟。等待一会儿，再查：

```bash
npm view @superwoererte/aiwiki versions --json
npm view @superwoererte/aiwiki dist-tags --json
```

### 提示版本已经发布过

npm 不允许覆盖同一个版本。需要 bump 到下一个版本再发。

例如 `0.1.3` 已经发布过，就改发 `0.1.4`。

### tag 打错了但还没推到 GitHub

如果本地 tag 指到了错误提交，而且还没有 `git push --tags`，可以修正：

```bash
git tag -f v0.1.3
```

如果 tag 已经推到 GitHub，不要随便 force push。优先发布下一个 patch 版本，把错误版本留作历史记录。

## 最短可复制流程

日常 patch 发布可以按这个顺序：

```bash
npm run release:check
npm version patch --no-git-tag-version
# 手动同步 src/constants.ts 的 AIWIKI_VERSION
npm run dev:aiwiki -- --version
npm run release:check
git add package.json package-lock.json src/constants.ts
git commit -m "chore: release <version>"
git tag v<version>
npm publish --access public
npm view @superwoererte/aiwiki version
git push origin main --tags
```
