import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dingtalk } from "../src/index.js";
import {
  cacheRoot,
  cliMissingHint,
  ensureReleaseCli,
  installedReleaseCli,
  parseChecksums,
  releaseAssetName,
  releasePlatformKey,
  releaseStatus,
} from "../src/cli/release.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "im-connector-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("release helpers", () => {
  it("maps platform and arch to the official asset names", () => {
    const release = dingtalk.release!;
    expect(releaseAssetName(release, releasePlatformKey("darwin", "arm64"))).toBe("dws-darwin-arm64.tar.gz");
    expect(releaseAssetName(release, releasePlatformKey("darwin", "x64"))).toBe("dws-darwin-amd64.tar.gz");
    expect(releaseAssetName(release, releasePlatformKey("linux", "x64"))).toBe("dws-linux-amd64.tar.gz");
    expect(releaseAssetName(release, releasePlatformKey("win32", "x64"))).toBe("dws-windows-amd64.zip");
    expect(releaseAssetName(release, releasePlatformKey("sunos", "sparc"))).toBeUndefined();
  });

  it("parses checksums.txt with and without the binary marker", () => {
    const sha = "a".repeat(64);
    const sums = parseChecksums(
      ["# comment", `${sha}  dws-darwin-arm64.tar.gz`, `${"b".repeat(64)} *dws-windows-amd64.zip`, "junk"].join("\n"),
    );
    expect(sums.get("dws-darwin-arm64.tar.gz")).toBe(sha);
    expect(sums.get("dws-windows-amd64.zip")).toBe("b".repeat(64));
    expect(sums.size).toBe(2);
  });

  it("honors IM_CONNECTOR_CACHE_DIR", () => {
    const dir = tempDir();
    expect(cacheRoot({ IM_CONNECTOR_CACHE_DIR: dir } as NodeJS.ProcessEnv)).toBe(dir);
  });

  it("reuses a previously downloaded binary", () => {
    const dir = tempDir();
    const exe = join(dir, "dws", "latest", "darwin-arm64", "dws");
    mkdirSync(join(dir, "dws", "latest", "darwin-arm64"), { recursive: true });
    writeFileSync(exe, "#!/bin/sh\n", { mode: 0o755 });
    const env = { IM_CONNECTOR_CACHE_DIR: dir } as NodeJS.ProcessEnv;
    expect(installedReleaseCli(dingtalk, { env, platform: "darwin", arch: "arm64" })).toBe(exe);
  });

  it("skips downloading when the platform has no official asset", async () => {
    const dir = tempDir();
    const messages: string[] = [];
    const result = await ensureReleaseCli(dingtalk, {
      env: { IM_CONNECTOR_CACHE_DIR: dir } as NodeJS.ProcessEnv,
      platform: "sunos",
      arch: "sparc",
      log: (message) => messages.push(message),
    });
    expect(result).toBeUndefined();
    expect(messages.join("\n")).toContain("sunos-sparc");
  });

  it("skips downloading when disabled", async () => {
    const dir = tempDir();
    const result = await ensureReleaseCli(dingtalk, {
      env: {
        IM_CONNECTOR_CACHE_DIR: dir,
        DINGTALK_DWS_NO_DOWNLOAD: "1",
      } as NodeJS.ProcessEnv,
      platform: "darwin",
      arch: "arm64",
      log: () => undefined,
    });
    expect(result).toBeUndefined();
    expect(releaseStatus()?.error).toContain("DINGTALK_DWS_NO_DOWNLOAD");
  });

  it("reports a repair list a user can follow", () => {
    const hint = cliMissingHint(dingtalk);
    expect(hint).toContain("dws 不可用");
    expect(hint).toContain("DINGTALK_DWS_DOWNLOAD_BASE");
    expect(hint).toContain("DINGTALK_DWS_BIN");
    expect(hint).toContain("DINGTALK_DWS_NO_DOWNLOAD");
    expect(hint).toContain("install.sh");
    expect(hint).toContain("install.ps1");
  });

  it("marks the bare PATH fallback as unavailable", async () => {
    const { CliRunner } = await import("../src/cli/runner.js");
    const runner = new CliRunner(dingtalk);
    const probe = await runner.probe("definitely-not-a-real-cli-xyz");
    expect(probe.fallback).toBe(true);
    expect(probe.resolved).toBeUndefined();
  });

  it("finds an installed CLI on PATH", async () => {
    const { pathCliExecutable } = await import("../src/cli/runner.js");
    const dir = tempDir();
    const name = process.platform === "win32" ? "dws.exe" : "dws";
    writeFileSync(join(dir, name), "");
    const env = { PATH: dir } as NodeJS.ProcessEnv;
    expect(pathCliExecutable("dws", env)).toBe(join(dir, name));
    expect(pathCliExecutable("dws-not-installed", env)).toBeUndefined();
  });
});
