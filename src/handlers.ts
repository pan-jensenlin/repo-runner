import { spawn } from "child_process";
import { WebSocket } from "ws";
import { LsproxyAction, LsproxyMessageParams, RunnerResponseStatus } from "./types.js";
import { sendResponse } from "./utils.js";
import * as core from "@actions/core";
import { runningProcesses } from "./processes.js";
import { startLsproxy, getIsLsproxyReady, getLsproxyProcess } from "./lsproxy.js";
import * as http from "http";

export function handleExecuteCommand({
  ws,
  commandId,
  params,
}: {
  ws: WebSocket;
  commandId: string;
  params: { command: string };
}) {
  const startTime = new Date();

  core.info(`[${startTime.toISOString()}] [${commandId}] Executing: ${params.command}`);

  const [command, ...args] = params.command.split(" ");
  const proc = spawn(command, args, {});

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
    const endTime = new Date();
    const durationMs = Math.round(endTime.getTime() - startTime.getTime());

    core.info(
      `[${endTime.toISOString()}] [${commandId}] Finished with exit code: ${code} (duration: ${durationMs}ms)`,
    );
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
    core.error(
      `[${new Date().toISOString()}] [${commandId}] Failed to start command: ${err.message}`,
    );
    runningProcesses.delete(commandId);
    sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
      message: `Failed to execute command: ${err.message}`,
      exitCode: -1, // Custom code for exec error
      stderr: err.message,
    });
  });
}

export function handleLsproxyCommand({
  ws,
  commandId,
  params,
}: {
  ws: WebSocket;
  commandId: string;
  params: LsproxyMessageParams;
}) {
  core.info(
    `[${new Date().toISOString()}][${commandId}] Received lsproxy command: ${params.action}`,
  );

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
      return runLsproxyApiCommand({
        ws,
        commandId,
        endpoint: "/workspace/list-files",
        method: "GET",
      });

    case LsproxyAction.GET_DEFINITION:
      return runLsproxyApiCommand({
        ws,
        commandId,
        endpoint: "/symbol/find-definition",
        method: "POST",
        body: params.actionParams,
      });

    case LsproxyAction.GET_REFERENCES:
      return runLsproxyApiCommand({
        ws,
        commandId,
        endpoint: "/symbol/find-references",
        method: "POST",
        body: params.actionParams,
      });

    case LsproxyAction.GET_DEFINITIONS_IN_FILE:
      return runLsproxyApiCommand({
        ws,
        commandId,
        endpoint: `/symbol/definitions-in-file?file_path=${encodeURIComponent(params.actionParams.path)}`,
        method: "GET",
      });

    case LsproxyAction.READ_SOURCE_CODE:
      return runLsproxyApiCommand({
        ws,
        commandId,
        endpoint: "/workspace/read-source-code",
        method: "POST",
        body: params.actionParams,
      });

    default:
      const unhandledAction = (params as any).action;
      core.warning(
        `[${new Date().toISOString()}][${commandId}] Unknown lsproxy action: ${unhandledAction}`,
      );
      return sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
        message: `Unknown lsproxy action: ${unhandledAction}`,
      });
  }
}

export function handleCancelCommand({
  ws,
  commandId,
  params,
}: {
  ws: WebSocket;
  commandId: string;
  params: { commandIdToCancel: string };
}) {
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

export function handleTerminate({ ws, commandId }: { ws: WebSocket; commandId: string }) {
  core.info("🏁 Terminate command received. Killing all running processes and shutting down...");
  sendResponse(ws, commandId, RunnerResponseStatus.SUCCESS, { ok: true });

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

function runLsproxyApiCommand({
  ws,
  commandId,
  endpoint,
  method = "GET",
  body,
}: {
  ws: WebSocket;
  commandId: string;
  endpoint: string;
  method?: string;
  body?: object;
}) {
  const startTime = new Date();

  if (!getIsLsproxyReady()) {
    core.error(
      `[${startTime.toISOString()}][${commandId}] lsproxy is not ready for endpoint: ${endpoint}`,
    );
    sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
      message: "lsproxy is not ready.",
    });
    return;
  }

  core.info(
    `[${startTime.toISOString()}][${commandId}] Running lsproxy command: ${method} /v1${endpoint}`,
  );

  const options: http.RequestOptions = {
    hostname: "localhost",
    port: 4444,
    path: `/v1${endpoint}`,
    method: method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  const req = http.request(options, (res) => {
    let responseBody = "";
    res.on("data", (chunk) => {
      responseBody += chunk;
    });

    res.on("end", () => {
      const endTime = new Date();
      const durationMs = Math.round(endTime.getTime() - startTime.getTime());

      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        const errorMessage = `Lsproxy API returned a non-successful status code: ${res.statusCode}`;
        core.error(
          `[${endTime.toISOString()}][${commandId}] ${errorMessage}\nResponse: ${responseBody}`,
        );
        return sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
          message: errorMessage,
          response: responseBody,
          httpStatus: res.statusCode,
        });
      }

      core.info(
        `[${endTime.toISOString()}][${commandId}] lsproxy command successful with status: ${res.statusCode} (duration: ${durationMs}ms)`,
      );
      try {
        const parsedBody = responseBody ? JSON.parse(responseBody) : {};
        sendResponse(ws, commandId, RunnerResponseStatus.SUCCESS, parsedBody);
      } catch (e) {
        const errorMessage = "Failed to parse lsproxy JSON response.";
        core.error(
          `[${endTime.toISOString()}][${commandId}] ${errorMessage}\nResponse: ${responseBody}`,
        );
        sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
          message: errorMessage,
          response: responseBody,
        });
      }
    });
  });

  req.on("error", (e) => {
    const errorMessage = `Lsproxy API command failed: ${e.message}`;
    core.error(`[${new Date().toISOString()}][${commandId}] ${errorMessage}`);
    sendResponse(ws, commandId, RunnerResponseStatus.ERROR, {
      message: errorMessage,
    });
  });

  if (body) {
    req.write(JSON.stringify(body));
  }
  req.end();
}
