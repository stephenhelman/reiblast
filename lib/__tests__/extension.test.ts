import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_BROWSERS, EXTENSION_VERSION, EXTENSION_ZIP_PATH, extensionsUrl } from "@/lib/extension";

describe("extension config", () => {
  it("builds the per-browser extensions URL", () => {
    expect(EXTENSION_BROWSERS.map(extensionsUrl)).toEqual([
      "chrome://extensions",
      "edge://extensions",
      "brave://extensions",
    ]);
  });

  it("points at the fixed zip path, which exists under public/", () => {
    expect(EXTENSION_ZIP_PATH).toBe("/downloads/reiscrub-puller.zip");
    expect(() => readFileSync(path.join(__dirname, "../../public", EXTENSION_ZIP_PATH))).not.toThrow();
  });

  it("EXTENSION_VERSION matches the manifest at the root of the shipped zip", () => {
    const zip = path.join(__dirname, "../../public", EXTENSION_ZIP_PATH);
    const manifest = JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }));
    expect(manifest.version).toBe(EXTENSION_VERSION);
  });
});
