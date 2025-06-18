import { exec } from "child_process";
import { WebSocket } from "ws";
import { RunnerResponseStatus } from "./types.js";
import { sendResponse, sendLog } from "./utils.js";
import * as core from "@actions/core";
import { runningProcesses } from "./processes.js";

export function handleExecuteCommand(
  ws: WebSocket,
  commandId: string,
  params: { command: string },
) {
  core.info(`[${commandId}] Executing: ${params.command}`);

  const proc = exec(params.command, {
    shell: "/bin/bash",
    maxBuffer: 10 * 1024 * 1024 /* 10MB */,
  });
  runningProcesses.set(commandId, proc);

  let stdout = "";
  let stderr = "";

  proc.stdout?.on("data", (data) => {
    const message = data.toString();
    sendLog(ws, commandId, "stdout", message);
    stdout += message;
  });
  proc.stderr?.on("data", (data) => {
    const message = data.toString();
    sendLog(ws, commandId, "stderr", message);
    stderr += message;
  });

  proc.on("exit", (code) => {
    core.info(`[${commandId}] Finished with exit code: ${code}`);
    runningProcesses.delete(commandId);

    const payload = {
      exitCode: code,
      stdout: stdout,
      stderr: stderr,
    };

    const status = code === 0 ? RunnerResponseStatus.SUCCESS : RunnerResponseStatus.ERROR;
    sendResponse(ws, commandId, status, payload);
  });

  proc.on("error", (err) => {
    core.error(`[${commandId}] Failed to start command: ${err.message}`);
    runningProcesses.delete(commandId);
    sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
      message: `Failed to execute command: ${err.message}`,
      exitCode: -1, // Custom code for exec error
      stderr: err.message,
    });
  });
}

export function handleLsproxyCommand(ws: WebSocket, commandId: string, params: any) {
  core.info(`[${commandId}] Received lsproxy command: ${params.action}`);
  // TODO: Implement logic to call lsproxy using `curl` via `handleExecuteCommand`.
  // This is a placeholder sending an immediate success response.
  sendResponse(ws, commandId, RunnerResponseStatus.SUCCESS, {
    message: `Lsproxy action '${params.action}' executed (placeholder).`,
  });
}

export function handleCancelCommand(
  ws: WebSocket,
  commandId: string,
  params: { commandIdToCancel: string },
) {
  const { commandIdToCancel } = params;
  const proc = runningProcesses.get(commandIdToCancel);

  if (proc) {
    core.info(`[${commandIdToCancel}] Received cancellation request. Terminating process.`);
    proc.kill("SIGTERM"); // Send SIGTERM for graceful shutdown
    runningProcesses.delete(commandIdToCancel);
    sendResponse(ws, commandId, RunnerResponseStatus.SUCCESS, {
      message: `Command ${commandIdToCancel} cancelled.`,
    });
  } else {
    core.warning(`[${commandIdToCancel}] Request to cancel non-existent or completed command.`);
    sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
      message: `Command ${commandIdToCancel} not found for cancellation.`,
    });
  }
}

export function handleTerminate(ws: WebSocket) {
  core.info("🏁 Terminate command received. Killing all running processes and shutting down...");
  runningProcesses.forEach((proc, id) => {
    core.info(`  - Killing process for command ${id}`);
    proc.kill();
  });
  ws.close(1000, "Work complete");

  // Allow time for the close frame to be sent before exiting.
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}
