import * as core from "@actions/core";
import { WebSocket } from "ws";
import { LogStreamType, RunnerMessageType, RunnerResponseStatus } from "./types.js";

// Send GitHub runner context to the server for every request
// Full list: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
const runnerMetadata = {
  githubRepo: process.env.GITHUB_REPOSITORY,
  githubRef: process.env.GITHUB_REF,
  githubRunId: process.env.GITHUB_RUN_ID, // Workflow run ID. This number does not change if you re-run the workflow run.
  githubSha: process.env.GITHUB_SHA, // Last commit on the GITHUB_REF (branch or tag that received dispatch)
  githubTriggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
  githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  githubWorkflowRef: process.env.GITHUB_WORKFLOW_REF,
};

export function sendLog(ws: WebSocket, commandId: string, stream: LogStreamType, message: string) {
  if (ws.readyState !== WebSocket.OPEN) {
    core.warning(`WebSocket not open. Cannot send log for ${commandId}`);
    return;
  }
  const logMessage = {
    command: RunnerMessageType.LOG,
    commandId,
    payload: {
      stream,
      message,
    },
  };
  ws.send(JSON.stringify(logMessage));
}

export function sendResponse(
  ws: WebSocket,
  originalCommandId: string,
  status: RunnerResponseStatus,
  payload: any,
) {
  if (ws.readyState !== WebSocket.OPEN) {
    core.warning(`WebSocket not open. Cannot send response for ${originalCommandId}`);
    return;
  }
  const message = {
    command: RunnerMessageType.RESPONSE,
    originalCommandId,
    status,
    payload,
    runnerMetadata,
  };
  core.info(
    `[${new Date().toISOString()}] ⬆️ Sending response for ${originalCommandId} with status ${status}`,
  );
  ws.send(JSON.stringify(message));
}
