import { describe, expect, it } from "vitest";

import {
  completeSlashCommand,
  completePromptToken,
  isLeadingSlashCommand,
  slashCommandSuggestions,
  promptSuggestions,
  validPromptTokenRanges,
  validSlashCommandRanges,
} from "../src/ui/slash-commands.js";

describe("slash command composer support", () => {
  it("recognizes valid commands anywhere in a prompt", () => {
    expect(validSlashCommandRanges("run /model then /not-real")).toEqual([
      { start: 4, end: 10 },
    ]);
  });

  it("suggests and completes the command under the cursor", () => {
    expect(slashCommandSuggestions("try /mo later", 7).map((command) => command.name)).toContain(
      "model",
    );
    expect(completeSlashCommand("try /mo later", 7)).toEqual({
      value: "try /model later",
      cursor: 10,
    });
  });

  it("only routes a valid leading command to the native TUI", () => {
    expect(isLeadingSlashCommand("/model")).toBe(true);
    expect(isLeadingSlashCommand("  /review staged changes")).toBe(true);
    expect(isLeadingSlashCommand("please /review this")).toBe(false);
    expect(isLeadingSlashCommand("/not-real")).toBe(false);
  });

  it("filters, completes, and recognizes installed skills", () => {
    const skills = [
      { name: "data-quality", description: "check data" },
      { name: "dashboard", description: "build dashboard" },
    ];

    expect(promptSuggestions("use $dash", 9, skills).map((item) => item.value)).toEqual([
      "$dashboard",
    ]);
    expect(promptSuggestions("use $dsh", 8, skills)[0]?.value).toBe("$dashboard");
    expect(completePromptToken("use $dash", 9, skills, 0)).toEqual({
      value: "use $dashboard",
      cursor: 14,
    });
    expect(validPromptTokenRanges("use $dashboard", skills)).toEqual([{ start: 4, end: 14 }]);
  });
});
