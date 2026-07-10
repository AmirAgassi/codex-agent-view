export interface SlashCommandDefinition {
  name: string;
  description: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
}

export interface PromptSuggestion {
  value: string;
  description: string;
  kind: "command" | "skill";
}

export interface TextRange {
  start: number;
  end: number;
}

interface PromptToken extends TextRange {
  query: string;
}

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { name: "model", description: "choose the model and reasoning effort" },
  { name: "fast", description: "toggle the Fast service tier" },
  { name: "permissions", description: "choose what Codex may do" },
  { name: "review", description: "review the current changes" },
  { name: "plan", description: "switch to Plan mode" },
  { name: "mention", description: "mention a file" },
  { name: "skills", description: "browse and use skills" },
  { name: "status", description: "show session configuration and usage" },
  { name: "debug-config", description: "show config layers and requirement sources" },
  { name: "diff", description: "show the Git diff" },
  { name: "compact", description: "summarize the conversation" },
  { name: "rename", description: "rename the current thread" },
  { name: "new", description: "start a new chat" },
  { name: "resume", description: "resume a saved chat" },
  { name: "fork", description: "fork the current chat" },
  { name: "init", description: "create an AGENTS.md file" },
  { name: "goal", description: "set or view the task goal" },
  { name: "agent", description: "switch the active agent thread" },
  { name: "subagents", description: "switch the active agent thread" },
  { name: "side", description: "start an ephemeral side conversation" },
  { name: "btw", description: "start an ephemeral side conversation" },
  { name: "mcp", description: "list configured MCP tools" },
  { name: "apps", description: "manage apps" },
  { name: "plugins", description: "browse plugins" },
  { name: "usage", description: "view account usage" },
  { name: "personality", description: "choose a communication style" },
  { name: "ide", description: "include current IDE context" },
  { name: "keymap", description: "remap TUI shortcuts" },
  { name: "vim", description: "toggle Vim composer mode" },
  { name: "experimental", description: "toggle experimental features" },
  { name: "approve", description: "approve a retry denied by automatic review" },
  { name: "memories", description: "configure memory use" },
  { name: "import", description: "import setup and chats from Claude Code" },
  { name: "hooks", description: "view and manage lifecycle hooks" },
  { name: "app", description: "continue this session in Codex Desktop" },
  { name: "copy", description: "copy the last response" },
  { name: "raw", description: "toggle raw scrollback mode" },
  { name: "ps", description: "list background terminals" },
  { name: "stop", description: "stop all background terminals" },
  { name: "clean", description: "stop all background terminals" },
  { name: "clear", description: "clear the terminal and start fresh" },
  { name: "title", description: "configure the terminal title" },
  { name: "statusline", description: "configure the status line" },
  { name: "theme", description: "choose a syntax highlighting theme" },
  { name: "pets", description: "choose or hide the terminal pet" },
  { name: "pet", description: "choose or hide the terminal pet" },
  { name: "archive", description: "archive this session and exit" },
  { name: "delete", description: "delete this session and exit" },
  { name: "quit", description: "exit Codex" },
  { name: "exit", description: "exit Codex" },
  { name: "logout", description: "log out of Codex" },
  { name: "feedback", description: "send logs to Codex maintainers" },
];

const COMMAND_NAMES = new Set(SLASH_COMMANDS.map((command) => command.name));
const COMMAND_CHARACTER = /^[a-z-]$/iu;
const SKILL_CHARACTER = /^[a-z0-9:_-]$/iu;

function fuzzyScore(value: string, query: string): number | undefined {
  if (query.length === 0) return 0;
  const candidate = value.toLowerCase();
  let previous = -1;
  let score = candidate.startsWith(query) ? -100 : 0;
  for (const character of query) {
    const index = candidate.indexOf(character, previous + 1);
    if (index < 0) return undefined;
    score += index - previous;
    previous = index;
  }
  return score;
}

function tokenAtCursor(
  value: string,
  cursor: number,
  sigil: "/" | "$",
  validCharacter: RegExp,
): PromptToken | undefined {
  const characters = Array.from(value);
  let nameStart = cursor;
  while (nameStart > 0 && validCharacter.test(characters[nameStart - 1] ?? "")) {
    nameStart -= 1;
  }
  const start = nameStart - 1;
  if (start < 0 || characters[start] !== sigil) return undefined;
  if (start > 0 && !/\s/u.test(characters[start - 1] ?? "")) return undefined;
  let end = cursor;
  while (end < characters.length && validCharacter.test(characters[end] ?? "")) end += 1;
  return {
    start,
    end,
    query: characters.slice(nameStart, end).join("").toLowerCase(),
  };
}

export function slashCommandSuggestions(
  value: string,
  cursor: number,
): readonly SlashCommandDefinition[] {
  const token = tokenAtCursor(value, cursor, "/", COMMAND_CHARACTER);
  if (!token) return [];
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(token.query)).slice(0, 5);
}

export function completeSlashCommand(
  value: string,
  cursor: number,
): { value: string; cursor: number } | undefined {
  const token = tokenAtCursor(value, cursor, "/", COMMAND_CHARACTER);
  const suggestion = slashCommandSuggestions(value, cursor)[0];
  if (!token || !suggestion) return undefined;
  const characters = Array.from(value);
  const replacement = Array.from(`/${suggestion.name}`);
  characters.splice(token.start, token.end - token.start, ...replacement);
  return {
    value: characters.join(""),
    cursor: token.start + replacement.length,
  };
}

export function promptSuggestions(
  value: string,
  cursor: number,
  skills: readonly SkillDefinition[],
): PromptSuggestion[] {
  const slashToken = tokenAtCursor(value, cursor, "/", COMMAND_CHARACTER);
  if (slashToken) {
    return SLASH_COMMANDS
      .filter((command) => command.name.startsWith(slashToken.query))
      .slice(0, 5)
      .map((command) => ({
        value: `/${command.name}`,
        description: command.description,
        kind: "command" as const,
      }));
  }

  const skillToken = tokenAtCursor(value, cursor, "$", SKILL_CHARACTER);
  if (!skillToken) return [];
  return skills
    .map((skill, index) => ({
      skill,
      index,
      score: fuzzyScore(skill.name, skillToken.query) ??
        fuzzyScore(skill.description, skillToken.query),
    }))
    .filter((match): match is typeof match & { score: number } => match.score !== undefined)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, 5)
    .map(({ skill }) => ({
      value: `$${skill.name}`,
      description: skill.description,
      kind: "skill" as const,
    }));
}

export function completePromptToken(
  value: string,
  cursor: number,
  skills: readonly SkillDefinition[],
  selectedIndex: number,
): { value: string; cursor: number } | undefined {
  const slashToken = tokenAtCursor(value, cursor, "/", COMMAND_CHARACTER);
  const skillToken = tokenAtCursor(value, cursor, "$", SKILL_CHARACTER);
  const token = slashToken ?? skillToken;
  const suggestions = promptSuggestions(value, cursor, skills);
  if (!token || suggestions.length === 0) return undefined;
  const suggestion = suggestions[Math.max(0, Math.min(selectedIndex, suggestions.length - 1))];
  if (!suggestion) return undefined;
  const characters = Array.from(value);
  const replacement = Array.from(suggestion.value);
  characters.splice(token.start, token.end - token.start, ...replacement);
  return {
    value: characters.join(""),
    cursor: token.start + replacement.length,
  };
}

export function validSlashCommandRanges(value: string): TextRange[] {
  const characters = Array.from(value);
  const ranges: TextRange[] = [];
  for (let start = 0; start < characters.length; start += 1) {
    if (characters[start] !== "/") continue;
    if (start > 0 && !/\s/u.test(characters[start - 1] ?? "")) continue;
    let end = start + 1;
    while (end < characters.length && COMMAND_CHARACTER.test(characters[end] ?? "")) end += 1;
    const name = characters.slice(start + 1, end).join("").toLowerCase();
    if (COMMAND_NAMES.has(name)) ranges.push({ start, end });
    start = end - 1;
  }
  return ranges;
}

export function validPromptTokenRanges(
  value: string,
  skills: readonly SkillDefinition[],
): TextRange[] {
  const ranges = validSlashCommandRanges(value);
  const skillNames = new Set(skills.map((skill) => skill.name.toLowerCase()));
  const characters = Array.from(value);
  for (let start = 0; start < characters.length; start += 1) {
    if (characters[start] !== "$") continue;
    if (start > 0 && !/\s/u.test(characters[start - 1] ?? "")) continue;
    let end = start + 1;
    while (end < characters.length && SKILL_CHARACTER.test(characters[end] ?? "")) end += 1;
    const name = characters.slice(start + 1, end).join("").toLowerCase();
    if (skillNames.has(name)) ranges.push({ start, end });
    start = end - 1;
  }
  return ranges;
}

export function isLeadingSlashCommand(value: string): boolean {
  const trimmed = value.trimStart();
  const match = /^\/([a-z-]+)(?:\s|$)/iu.exec(trimmed);
  return match?.[1] !== undefined && COMMAND_NAMES.has(match[1].toLowerCase());
}
