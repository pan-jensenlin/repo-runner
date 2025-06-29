import * as core from "@actions/core";
import WebSocket from "ws";
import { BackendCommandType, RunnerResponseStatus, TestingRunType } from "./types.js";
import { runningProcesses } from "./processes.js";
import {
  handleExecuteCommand,
  handleLsproxyCommand,
  handleCancelCommand,
  handleTerminate,
} from "./handlers.js";
import { sendResponse } from "./utils.js";
import { startLsproxy } from "./lsproxy.js";

const RUNNER_TIMEOUT_MS = 1 * 60 * 60 * 1000; // 1 hour

function forceShutdown(reason: string) {
  core.setFailed(reason);

  runningProcesses.forEach((proc, id) => {
    core.info(`  - Killing process for command ${id}`);
    proc.kill("SIGKILL");
  });

  process.exit(1);
}

let runnerTimeout: NodeJS.Timeout;

async function run(): Promise<void> {
  try {
    runnerTimeout = setTimeout(
      () => forceShutdown(`Runner timed out after ${RUNNER_TIMEOUT_MS / 1000}s.`),
      RUNNER_TIMEOUT_MS,
    );

    const tuskUrl: string = core.getInput("tuskUrl", { required: true });

    const url = new URL(tuskUrl);
    const queryParams = url.searchParams;
    const runId = queryParams.get("runId");
    const runType = queryParams.get("runType");

    if (!runId || !runType) {
      throw new Error("tuskUrl must contain runId and runType query parameters");
    }

    if (!Object.values(TestingRunType).includes(runType as TestingRunType)) {
      throw new Error(`Invalid runType: ${runType}`);
    }

    core.info("Starting lsproxy...");
    await startLsproxy();
    core.info("lsproxy started successfully.");

    const websocketUrl = url.toString().replace(/^http/, "ws");

    core.info(`Connecting to WebSocket: ${websocketUrl}`);

    const ws = new WebSocket(websocketUrl);

    // --- WebSocket event handlers ---

    ws.on("open", () => {
      core.info(
        `[${new Date().toISOString()}] ✅ WebSocket connection established. Awaiting instructions...`,
      );
    });

    ws.on("message", async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        core.info(
          `[${new Date().toISOString()}] ⬇️ Received command: ${message.command} (ID: ${message.commandId})`,
        );

        switch (message.command) {
          case BackendCommandType.EXECUTE_COMMAND:
            handleExecuteCommand({ ws, commandId: message.commandId, params: message.params });
            break;
          case BackendCommandType.LSPROXY_COMMAND:
            handleLsproxyCommand({ ws, commandId: message.commandId, params: message.params });
            break;
          case BackendCommandType.CANCEL_COMMAND:
            handleCancelCommand({ ws, commandId: message.commandId, params: message.params });
            break;
          case BackendCommandType.TERMINATE:
            clearTimeout(runnerTimeout);
            handleTerminate({ ws, commandId: message.commandId });
            break;
          default:
            core.warning(
              `[${new Date().toISOString()}] Unknown command received: ${message.command}`,
            );
            sendResponse(ws, message.commandId, RunnerResponseStatus.ERROR, {
              message: `Unknown command: ${message.command}`,
            });
        }
      } catch (error) {
        core.error(`[${new Date().toISOString()}] Error processing message: ${data.toString()}`);
        if (error instanceof Error) {
          core.setFailed(error.message);
        }
      }
    });

    ws.on("close", (code, reason) => {
      core.info(
        `[${new Date().toISOString()}] 🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason.toString()}`,
      );
      clearTimeout(runnerTimeout);
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
