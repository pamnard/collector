import { describe, expect, it } from "vitest";
import { CliUsageError } from "../types.js";
import { COMMAND_PARSERS } from "./registry.js";
import {
  COMMAND_USAGE,
  formatCommandHelp,
  formatTopLevelHelp,
  tryParseCliHelp,
} from "./help.js";

describe("CLI help", () => {
  it("COMMAND_USAGE keys stay in sync with COMMAND_PARSERS", () => {
    expect(Object.keys(COMMAND_USAGE).sort()).toEqual(
      Object.keys(COMMAND_PARSERS).sort(),
    );
  });

  it("tryParseCliHelp returns top-level help for help / --help without dial flags", () => {
    for (const argv of [["help"], ["--help"], ["-h"]] as const) {
      const text = tryParseCliHelp([...argv]);
      expect(text).toBeDefined();
      expect(text).toContain("--base-url");
      expect(text).toContain("--data-dir");
      expect(text).toContain("--token");
      for (const name of Object.keys(COMMAND_PARSERS)) {
        expect(text).toContain(name);
      }
    }
  });

  it("tryParseCliHelp returns per-command help for help <command> and command --help", () => {
    const viaHelp = tryParseCliHelp(["help", "search"]);
    const viaFlag = tryParseCliHelp(["search", "--help"]);
    expect(viaHelp).toBe(formatCommandHelp("search"));
    expect(viaFlag).toBe(formatCommandHelp("search"));
    expect(viaHelp).toContain("search");
  });

  it("tryParseCliHelp ignores dial flags when resolving help", () => {
    const text = tryParseCliHelp([
      "--base-url",
      "http://127.0.0.1:9",
      "--data-dir",
      "/tmp/data",
      "--help",
    ]);
    expect(text).toBe(formatTopLevelHelp());
  });

  it("tryParseCliHelp throws on unknown help topic", () => {
    expect(() => tryParseCliHelp(["help", "no-such-command"])).toThrow(
      CliUsageError,
    );
    expect(() => tryParseCliHelp(["no-such-command", "--help"])).toThrow(
      CliUsageError,
    );
  });

  it("tryParseCliHelp returns undefined for normal commands", () => {
    expect(
      tryParseCliHelp(["--base-url", "http://127.0.0.1:9", "health"]),
    ).toBeUndefined();
  });
});
