import { exec } from "child_process";
import { WebSocket } from "ws";
import { LsproxyAction, LsproxyMessageParams, RunnerResponseStatus } from "./types.js";
import { sendResponse } from "./utils.js";
import * as core from "@actions/core";
import { runningProcesses } from "./processes.js";
import { startLsproxy, getIsLsproxyReady, getLsproxyProcess } from "./lsproxy.js";

export function handleExecuteCommand(
  ws: WebSocket,
  commandId: string,
  params: { command: string },
) {
  core.info(`[${commandId}] Executing: ${params.command}`);

  const proc = exec(params.command, {
    shell: "/bin/bash",
    maxBuffer: 10 * 1024 * 1024, // 10MB,
  });
  runningProcesses.set(commandId, proc);

  let stdout = "";
  let stderr = "";

  proc.stdout?.on("data", (data) => {
    const message = data.toString();
    // This can be noisy, but useful for debugging
    // sendLog(ws, commandId, "stdout", message);
    stdout += message;
  });
  proc.stderr?.on("data", (data) => {
    const message = data.toString();
    // sendLog(ws, commandId, "stderr", message);
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

export function handleLsproxyCommand(
  ws: WebSocket,
  commandId: string,
  params: LsproxyMessageParams,
) {
  core.info(`[${commandId}] Received lsproxy command: ${params.action}`);

  switch (params.action) {
    // Note: lsproxy is started automatically when the runner is up (see `index.ts`)
    // but we keep this handler for manual restarts in case the lsproxy process is killed.
    case LsproxyAction.START:
      core.info(`[${commandId}] Received request to start lsproxy.`);
      startLsproxy()
        .then(() => {
          sendResponse(ws, commandId, RunnerResponseStatus.SUCCESS, {
            message: "lsproxy is ready.",
          });
        })
        .catch((err) => {
          sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
            message: `Failed to start lsproxy: ${err.message}`,
          });
        });
      return;

    case LsproxyAction.LIST_FILES:
      return runLsproxyApiCommand(ws, commandId, "/workspace/list-files", "GET");

    case LsproxyAction.GET_DEFINITION:
      return runLsproxyApiCommand(
        ws,
        commandId,
        "/symbol/find-definition",
        "POST",
        params.actionParams,
      );

    case LsproxyAction.GET_REFERENCES:
      return runLsproxyApiCommand(
        ws,
        commandId,
        "/symbol/find-references",
        "POST",
        params.actionParams,
      );

    case LsproxyAction.GET_DEFINITIONS_IN_FILE:
      return runLsproxyApiCommand(
        ws,
        commandId,
        `/symbol/definitions-in-file?file_path=${encodeURIComponent(params.actionParams.path)}`,
        "GET",
      );

    case LsproxyAction.READ_SOURCE_CODE:
      return runLsproxyApiCommand(
        ws,
        commandId,
        "/workspace/read-source-code",
        "POST",
        params.actionParams,
      );

    default:
      const unhandledAction = (params as any).action;
      core.warning(`Unknown lsproxy action: ${unhandledAction}`);
      return sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
        message: `Unknown lsproxy action: ${unhandledAction}`,
      });
  }
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
    // Using SIGKILL to ensure termination, as lsproxy might be exiting gracefully
    // with code 0 on SIGTERM, which can be ambiguous.
    proc.kill("SIGKILL");
  });
  const lsproxyProcess = getLsproxyProcess();
  if (lsproxyProcess) {
    core.info(`  - Killing lsproxy process`);
    lsproxyProcess.kill("SIGKILL");
  }
  ws.close(1000, "Work complete");

  // Allow time for the close frame to be sent before exiting.
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

function runLsproxyApiCommand(
  ws: WebSocket,
  commandId: string,
  endpoint: string,
  method = "GET",
  body: object | null = null,
) {
  if (!getIsLsproxyReady()) {
    sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
      message: "lsproxy is not ready.",
    });
    return;
  }

  const bodyData = body ? `--data '${JSON.stringify(body)}'` : "";
  const headers = "--header 'Content-Type: application/json'";
  const curlCmd = `curl -s -X ${method} http://localhost:4444/v1${endpoint} ${headers} ${bodyData}`;

  const proc = exec(curlCmd, { shell: "/bin/bash" });
  let stdout = "";
  proc.stdout?.on("data", (data) => (stdout += data));
  proc.on("exit", (code) => {
    if (code !== 0) {
      return sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
        message: `Lsproxy API command failed with exit code ${code}`,
      });
    }
    try {
      sendResponse(ws, commandId, RunnerResponseStatus.SUCCESS, JSON.parse(stdout));
    } catch (e) {
      sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
        message: "Failed to parse lsproxy JSON response.",
        response: stdout,
      });
    }
  });
}
