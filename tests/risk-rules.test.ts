import { describe, expect, it } from "vitest";
import {
  detectFileLanguage,
  detectProjectProfile,
  diffRiskLessonsFromChanges,
  representativeRiskFiles,
  semanticChangeRiskMessages
} from "../src/risk-rules.js";

describe("risk rules", () => {
  it("detects priority project languages from manifests and source files", () => {
    const profile = detectProjectProfile([
      "pyproject.toml",
      "src/server.py",
      "pom.xml",
      "src/main/java/App.java",
      "package.json",
      "tsconfig.json",
      "src/index.ts",
      "Makefile",
      "src/main.c"
    ]);

    expect(profile.languages).toEqual(
      expect.arrayContaining(["python", "java", "typescript", "javascript", "c"])
    );
    expect(profile.manifests).toEqual(
      expect.arrayContaining(["pyproject.toml", "pom.xml", "package.json", "tsconfig.json", "Makefile"])
    );
    expect(detectFileLanguage("src/main.c")).toBe("c");
  });

  it("surfaces generic semantic risks for Python, Java, JS/TS, and C", () => {
    const files = [
      "pyproject.toml",
      "app/routes.py",
      "pom.xml",
      "src/main/java/UserController.java",
      "package.json",
      "src/app/api/auth/route.ts",
      "Makefile",
      "src/buffer.c",
      "include/public.h"
    ];

    expect(
      semanticChangeRiskMessages({
        filePath: "app/routes.py",
        content: "import subprocess\n@app.route('/run')\ndef run(): subprocess.run(['echo'])\n",
        files
      }).join("\n")
    ).toContain("Python web/API boundary change");

    expect(
      semanticChangeRiskMessages({
        filePath: "src/main/java/UserController.java",
        content: "@RestController class UserController { synchronized void update() {} }\n",
        files
      }).join("\n")
    ).toContain("Java controller/API boundary change");

    expect(
      semanticChangeRiskMessages({
        filePath: "src/app/api/auth/route.ts",
        content: "export const token = process.env.SECRET_TOKEN;\n",
        files
      }).join("\n")
    ).toContain("Server/API boundary change");

    expect(
      semanticChangeRiskMessages({
        filePath: "src/buffer.c",
        content: "void copy(char *dst, char *src) { strcpy(dst, src); }\n",
        files
      }).join("\n")
    ).toContain("C memory-safety-sensitive change");
  });

  it("converts priority language risk hits into reflect lessons", () => {
    const changedFiles = [
      "pyproject.toml",
      "src/main/java/UserService.java",
      "Makefile",
      "src/buffer.c"
    ];
    const linesByFile = new Map<string, string[]>([
      ["pyproject.toml", ["[project]", "dependencies = ['requests']"]],
      ["src/main/java/UserService.java", ["@Transactional", "synchronized void update() {}"]],
      ["Makefile", ["CFLAGS += -DNEW_FLAG"]],
      ["src/buffer.c", ["char *p = malloc(10);", "memcpy(p, input, 20);"]]
    ]);

    const lessons = diffRiskLessonsFromChanges(changedFiles, linesByFile);

    expect(lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Python dependency changes need environment smoke tests" }),
        expect.objectContaining({ title: "Java transaction and concurrency changes need race-path checks" }),
        expect.objectContaining({ title: "C build-system changes need platform matrix checks" }),
        expect.objectContaining({ title: "C memory changes need sanitizer-minded review" })
      ])
    );
  });

  it("selects representative guard targets for cold-start priority language projects", () => {
    const targets = representativeRiskFiles([
      "README.md",
      "pyproject.toml",
      "django/contrib/auth/views.py",
      "pom.xml",
      "src/main/java/UserController.java",
      "package.json",
      "src/app/api/auth/route.ts",
      "Makefile",
      "include/project/api.h",
      "lib/memdebug.c"
    ]);

    expect(targets).toEqual(
      expect.arrayContaining([
        "django/contrib/auth/views.py",
        "src/main/java/UserController.java",
        "src/app/api/auth/route.ts",
        "include/project/api.h",
        "lib/memdebug.c"
      ])
    );
  });
});
