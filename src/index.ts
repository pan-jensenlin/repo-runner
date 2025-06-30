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
import * as os from "os";

const RUNNER_TIMEOUT_MS = 1 * 60 * 60 * 1000; // 1 hour

function forceShutdown(reason: string) {
  core.setFailed(reason);
  clearInterval(statsInterval);

  runningProcesses.forEach((proc, id) => {
    core.info(`  - Killing process for command ${id}`);
    proc.kill("SIGKILL");
  });

  process.exit(1);
}

let runnerTimeout: NodeJS.Timeout;
let statsInterval: NodeJS.Timeout;

let previousCpuTimes = os.cpus().map((c) => c.times);

function logSystemStats() {
  // System Memory
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memUsage = `${(usedMemory / 1024 / 1024 / 1024).toFixed(2)}GB / ${(
    totalMemory /
    1024 /
    1024 /
    1024
  ).toFixed(2)}GB`;

  // Process Memory
  const processMem = process.memoryUsage();
  const processMemUsage = `RSS: ${(processMem.rss / 1024 / 1024).toFixed(2)}MB, Heap: ${(
    processMem.heapUsed /
    1024 /
    1024
  ).toFixed(2)}MB`;

  // CPU Usage
  const currentCpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (let i = 0; i < currentCpus.length; i++) {
    const start = previousCpuTimes[i];
    const end = currentCpus[i].times;
    const idle = end.idle - start.idle;
    const total =
      end.user -
      start.user +
      (end.nice - start.nice) +
      (end.sys - start.sys) +
      (end.irq - start.irq) +
      idle;
    totalIdle += idle;
    totalTick += total;
  }
  const cpuUsage = (totalTick > 0 ? 100 * (1 - totalIdle / totalTick) : 0).toFixed(2);
  previousCpuTimes = currentCpus.map((c) => c.times);

  // Running child processes
  const numProcesses = runningProcesses.size;

  core.info(
    `[STATS] MEM: ${memUsage} (${((usedMemory / totalMemory) * 100).toFixed(
      2,
    )}%) | Process MEM: ${processMemUsage} | CPU: ${cpuUsage}% | Child Processes: ${numProcesses}`,
  );
}

async function run(): Promise<void> {
  try {
    runnerTimeout = setTimeout(
      () => forceShutdown(`Runner timed out after ${RUNNER_TIMEOUT_MS / 1000}s.`),
      RUNNER_TIMEOUT_MS,
    );

    statsInterval = setInterval(logSystemStats, 10_000);

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
            clearInterval(statsInterval);
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
      clearInterval(statsInterval);
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
