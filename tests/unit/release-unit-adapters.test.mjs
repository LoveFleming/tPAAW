import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rustAdapter, javaAdapter, detectAdapter } from "@server/lib/release-unit/adapters.mjs";

function tmpProject(files) {
  const root = mkdtempSync(join(tmpdir(), "adapters-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

describe("rustAdapter", () => {
  it("detects Cargo.toml", async () => {
    const root = tmpProject({ "Cargo.toml": "[package]\nname = \"x\"" });
    expect(await rustAdapter.detect(root)).toBe(true);
    expect(await detectAdapter(root)).toBe(rustAdapter);
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts use statements via importRegexes", () => {
    const code = "use std::collections::HashMap;\npub use crate::util::helper;\nfn main() {}";
    const stripped = rustAdapter.stripComments(code);
    const found = [];
    for (const re of rustAdapter.importRegexes) {
      re.lastIndex = 0;
      let m; while ((m = re.exec(stripped))) found.push(m[1]);
    }
    expect(found.some(x => x === "std::collections::HashMap")).toBe(true);
    expect(found.some(x => x === "crate::util::helper")).toBe(true);
  });

  it("verifyCommands uses cargo", async () => {
    const root = tmpProject({ "Cargo.toml": "[package]" });
    const cmds = await rustAdapter.verifyCommands(root);
    expect(cmds.build).toBe("cargo build");
    expect(cmds.test).toBe("cargo test");
    expect(cmds["type-check"]).toBe("cargo check");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("javaAdapter", () => {
  const quarkusPom = `<?xml version="1.0"?><project>
    <dependencies><dependency>
      <groupId>io.quarkus</groupId><artifactId>quarkus-core</artifactId>
    </dependency></dependencies></project>`;

  it("detects Quarkus pom", async () => {
    const root = tmpProject({ "pom.xml": quarkusPom });
    expect(await javaAdapter.detect(root)).toBe(true);
    expect((await detectAdapter(root)).id).toBe("java");
    rmSync(root, { recursive: true, force: true });
  });

  it("detects plain maven project", async () => {
    const root = tmpProject({ "pom.xml": "<project/>", "src/main/java/App.java": "class App {}" });
    expect(await javaAdapter.detect(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts java imports", () => {
    const code = "package com.x;\nimport java.util.List;\nimport static org.assertj.core.api.Assertions.assertThat;\nclass A {}";
    const stripped = javaAdapter.stripComments(code);
    const found = [];
    for (const re of javaAdapter.importRegexes) {
      re.lastIndex = 0;
      let m; while ((m = re.exec(stripped))) found.push(m[1]);
    }
    expect(found).toContain("java.util.List");
    expect(found).toContain("org.assertj.core.api.Assertions");
  });

  it("verifyCommands prefers wrapper and packages for quarkus", async () => {
    const root = tmpProject({ "pom.xml": quarkusPom, "mvnw": "#!/bin/sh" });
    const cmds = await javaAdapter.verifyCommands(root);
    const mvn = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
    expect(cmds.build).toBe(`${mvn} package -DskipTests -q`);
    expect(cmds.test).toBe(`${mvn} test`);
    rmSync(root, { recursive: true, force: true });
  });

  it("verifyCommands falls back to system maven", async () => {
    const root = tmpProject({ "pom.xml": quarkusPom });
    const cmds = await javaAdapter.verifyCommands(root);
    expect(cmds.build).toBe("mvn package -DskipTests -q");
    rmSync(root, { recursive: true, force: true });
  });
});
