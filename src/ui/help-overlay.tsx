import React, { memo } from "react";
import { Box, Text } from "ink";

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["j / ↓", "next session"],
  ["k / ↑", "previous session"],
  ["→ / enter", "open native Codex chat"],
  ["shift+← / ^B", "park native chat; keep it warm"],
  ["v", "peek at selected session"],
  ["n", "dispatch a new task"],
  ["space", "reply or answer input"],
  ["a", "allow request once"],
  ["s", "allow for this session"],
  ["d / c", "decline / cancel request"],
  ["x", "interrupt working session"],
  ["e", "rename selected session"],
  ["z", "archive selected session"],
  ["p", "pin or unpin session"],
  ["o", "attach in native Codex"],
  ["r", "refresh sessions"],
  ["esc", "close panel or cancel input"],
  ["q / ctrl+c", "quit"],
];

interface HelpOverlayProps {
  width: number;
  height: number;
}

function HelpOverlayComponent({ width, height }: HelpOverlayProps): React.JSX.Element {
  const columnCount = width >= 72 ? 2 : 1;
  const maxRows = Math.max(4, height - 8);
  const fullRows = Math.ceil(SHORTCUTS.length / columnCount);
  const visibleShortcuts = fullRows <= maxRows
    ? SHORTCUTS
    : [
        ...SHORTCUTS.slice(0, Math.max(1, maxRows - 1)),
        ["…", `${SHORTCUTS.length - maxRows + 1} more; resize for all`] as const,
      ];
  const midpoint = Math.ceil(visibleShortcuts.length / columnCount);
  const columns = columnCount === 2
    ? [visibleShortcuts.slice(0, midpoint), visibleShortcuts.slice(midpoint)]
    : [visibleShortcuts];
  const columnWidth = columnCount === 2
    ? Math.max(24, Math.floor((width - 12) / 2))
    : Math.max(24, width - 10);

  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center" paddingX={2}>
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text bold color="magenta">Keyboard shortcuts</Text>
          <Text dimColor>? or esc to close</Text>
        </Box>
        <Box columnGap={4}>
          {columns.map((column, columnIndex) => (
            <Box key={columnIndex} flexDirection="column" width={columnWidth}>
              {column.map(([shortcut, description]) => (
                <Box key={shortcut}>
                  <Box width={11} flexShrink={0} marginRight={1}>
                    <Text bold color="cyan">{shortcut}</Text>
                  </Box>
                  <Text wrap="truncate-end">{description}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export const HelpOverlay = memo(HelpOverlayComponent);
