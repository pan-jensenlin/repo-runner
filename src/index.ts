import * as core from "@actions/core";
import WebSocket from "ws";
import { BackendCommandType, RunnerResponseStatus } from "./types.js";
import { runningProcesses } from "./processes.js";
import {
  handleExecuteCommand,
  handleLsproxyCommand,
  handleCancelCommand,
  handleTerminate,
} from "./handlers.js";
import { sendResponse } from "./utils.js";

async function run(): Promise<void> {
  try {
    const tuskUrl: string = core.getInput("tuskUrl", { required: true });
    const runId: string = core.getInput("runId", { required: true });

    const url = new URL(tuskUrl);
    const websocketUrl = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/ws/sandbox`;

    core.info(`Connecting to WebSocket: ${websocketUrl}`);

    const ws = new WebSocket(websocketUrl);

    // --- WebSocket event handlers ---

    ws.on("open", () => {
      core.info("✅ WebSocket connection established. Sending auth message...");
      ws.send(JSON.stringify({ type: "auth", runId: runId }));
      core.info("✅ Auth message sent. Awaiting instructions...");
    });

    ws.on("message", async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        core.info(`⬇️ Received command: ${message.command} (ID: ${message.commandId})`);

        switch (message.command) {
          case BackendCommandType.EXECUTE_COMMAND:
            handleExecuteCommand(ws, message.commandId, message.params);
            break;
          case BackendCommandType.LSPROXY_COMMAND:
            // Placeholder for lsproxy logic
            handleLsproxyCommand(ws, message.commandId, message.params);
            break;
          case BackendCommandType.CANCEL_COMMAND:
            handleCancelCommand(ws, message.commandId, message.params);
            break;
          case BackendCommandType.TERMINATE:
            handleTerminate(ws);
            break;
          default:
            core.warning(`Unknown command received: ${message.command}`);
            sendResponse(ws, message.commandId, RunnerResponseStatus.ERROR, {
              message: `Unknown command: ${message.command}`,
            });
        }
      } catch (error) {
        core.error(`Error processing message: ${data.toString()}`);
        if (error instanceof Error) {
          core.setFailed(error.message);
        }
      }
    });

    ws.on("close", (code, reason) => {
      core.info(`🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`);
      // Clean up any lingering processes on close
      runningProcesses.forEach((proc) => proc.kill());
      if (code !== 1000) {
        core.setFailed(`WebSocket closed with non-standard code: ${code}`);
      }
    });

    ws.on("error", (error) => {
      core.setFailed(`WebSocket error: ${error.message}`);
    });
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
