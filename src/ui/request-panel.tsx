import React, { memo } from "react";
import { Box, Text } from "ink";
import type { PendingRequest } from "../domain/types.js";
import {
  abbreviateHome,
  isApprovalRequest,
  parseQuestions,
  requestCommand,
  requestCwd,
  requestDescription,
  requestScopeDetails,
} from "./format.js";
import type { ParsedQuestion } from "./types.js";

interface RequestPanelProps {
  request: PendingRequest;
  questionIndex?: number;
}

function ApprovalDetails({ request }: { request: PendingRequest }): React.JSX.Element {
  const command = requestCommand(request);
  const cwd = requestCwd(request);
  const scope = requestScopeDetails(request);

  return (
    <>
      <Text wrap="truncate-end">{requestDescription(request)}</Text>
      {command ? (
        <Text color="cyan" wrap="truncate-end">
          $ {command}
        </Text>
      ) : null}
      {cwd ? (
        <Text dimColor wrap="truncate-end">
          in {abbreviateHome(cwd)}
        </Text>
      ) : null}
      {scope.map((detail) => (
        <Text key={detail} color="yellow" wrap="truncate-end">
          {detail}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color="green" bold>a</Text>
        <Text> allow once </Text>
        <Text color="cyan" bold>s</Text>
        <Text> session </Text>
        <Text color="red" bold>d</Text>
        <Text> decline </Text>
        <Text color="yellow" bold>c</Text>
        <Text> cancel</Text>
      </Box>
    </>
  );
}

function QuestionDetails({
  question,
  index,
  total,
}: {
  question: ParsedQuestion;
  index: number;
  total: number;
}): React.JSX.Element {
  return (
    <>
      <Box>
        {question.header ? <Text bold>{question.header}: </Text> : null}
        <Text wrap="truncate-end">{question.question}</Text>
        {total > 1 ? <Text dimColor> ({index + 1}/{total})</Text> : null}
      </Box>
      {question.options.slice(0, 5).map((option, optionIndex) => (
        <Text key={`${question.id}:${option.label}`} wrap="truncate-end">
          <Text color="yellow">{optionIndex + 1}</Text> {option.label}
          {option.description ? <Text dimColor> — {option.description}</Text> : null}
        </Text>
      ))}
      <Text dimColor>
        space to answer{question.options.length > 0 ? " · choose 1–9 or type a response" : ""}
      </Text>
    </>
  );
}

function RequestPanelComponent({
  request,
  questionIndex = 0,
}: RequestPanelProps): React.JSX.Element {
  const questions = parseQuestions(request);
  const question = questions[Math.min(questionIndex, Math.max(0, questions.length - 1))];
  const approval = isApprovalRequest(request);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginX={1}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text bold color="yellow">
          {approval ? "Approval required" : question ? "Input required" : "Request pending"}
        </Text>
        <Text dimColor wrap="truncate-start">
          {request.method}
        </Text>
      </Box>
      {approval ? (
        <ApprovalDetails request={request} />
      ) : question ? (
        <QuestionDetails question={question} index={questionIndex} total={questions.length} />
      ) : (
        <>
          <Text wrap="truncate-end">{requestDescription(request)}</Text>
          <Text dimColor>
            Unsupported request · <Text color="red">d</Text> decline ·{" "}
            <Text color="yellow">c</Text> cancel
          </Text>
        </>
      )}
    </Box>
  );
}

export const RequestPanel = memo(RequestPanelComponent);
