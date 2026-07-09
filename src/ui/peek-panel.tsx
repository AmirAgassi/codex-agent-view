import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import type { SessionRecord } from "../domain/types.js";
import { abbreviateHome, compactText, sessionName } from "./format.js";

interface PeekPanelProps {
  session: SessionRecord;
  maxLines?: number;
}

interface PeekLine {
  key: string;
  prefix?: string;
  text: string;
  color?: string;
  dim?: boolean;
}

function buildLines(session: SessionRecord, maxLines: number): PeekLine[] {
  const lines: PeekLine[] = [];
  const activePlan = session.plan.filter((step) => step.status !== "completed");

  for (const [index, step] of activePlan.entries()) {
    if (lines.length >= maxLines - 1) break;
    lines.push({
      key: `plan:${index}`,
      prefix:
        step.status === "inProgress" || step.status === "in_progress" ? "* " : "· ",
      text: compactText(step.step),
      color:
        step.status === "inProgress" || step.status === "in_progress"
          ? "cyan"
          : undefined,
      dim: step.status !== "inProgress" && step.status !== "in_progress",
    });
  }

  if (lines.length < maxLines) {
    const latest = session.latestText || session.activity || session.thread.preview;
    for (const [index, line] of latest.split(/\r?\n/).entries()) {
      const compact = compactText(line);
      if (!compact) continue;
      lines.push({ key: `text:${index}`, text: compact });
      if (lines.length >= maxLines) break;
    }
  }

  if (lines.length === 0) {
    lines.push({ key: "empty", text: "No output yet.", dim: true });
  }

  return lines;
}

function PeekPanelComponent({
  session,
  maxLines = 5,
}: PeekPanelProps): React.JSX.Element {
  const lines = useMemo(() => buildLines(session, maxLines), [session, maxLines]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginX={1}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text bold color="magenta">
          Peek · {sessionName(session)}
        </Text>
        <Text dimColor wrap="truncate-start">
          {abbreviateHome(session.thread.cwd)}
        </Text>
      </Box>
      {lines.map((line) => (
        <Text key={line.key} color={line.color} dimColor={line.dim} wrap="truncate-end">
          {line.prefix ?? "  "}
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export const PeekPanel = memo(PeekPanelComponent);
