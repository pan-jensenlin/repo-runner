import * as core from "@actions/core";
import { WebSocket } from "ws";
import { LogStreamType, RunnerMessageType, RunnerResponseStatus } from "./types.js";

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
  };
  core.info(`⬆️ Sending response for ${originalCommandId} with status ${status}`);
  ws.send(JSON.stringify(message));
}
