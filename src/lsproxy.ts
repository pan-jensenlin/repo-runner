import { ChildProcess, exec } from "child_process";
import * as core from "@actions/core";
import { runningProcesses } from "./processes.js";

let lsproxyProcess: ChildProcess | null = null;
let isLsproxyReady = false;
let startupPromise: Promise<void> | null = null;

export function getLsproxyProcess(): ChildProcess | null {
  return lsproxyProcess;
}

export function getIsLsproxyReady(): boolean {
  return isLsproxyReady;
}

export function startLsproxy(): Promise<void> {
  if (!startupPromise) {
    startupPromise = new Promise((resolve, reject) => {
      if (isLsproxyReady) {
        core.info("lsproxy is already running and ready.");
        return resolve();
      }

      core.info("Starting lsproxy...");
      const repoPath = process.env.GITHUB_WORKSPACE || "/github/workspace";
      const lsproxyCmd = `USE_AUTH=false lsproxy --mount-dir ${repoPath}`;

      const proc = exec(lsproxyCmd, { shell: "/bin/bash" });
      lsproxyProcess = proc;
      runningProcesses.set("lsproxy_process", proc);

      proc.stdout?.on("data", (data) => core.info(`lsproxy-out: ${data.toString().trim()}`));
      proc.stderr?.on("data", (data) => core.error(`lsproxy-err: ${data.toString().trim()}`));

      proc.on("exit", (code, signal) => {
        core.info(`lsproxy process exited. Code: ${code}, Signal: ${signal}`);
        lsproxyProcess = null;
        isLsproxyReady = false;
        runningProcesses.delete("lsproxy_process");
        startupPromise = null; // Allow restarting
      });

      const maxRetries = 60; // Poll for 2 minutes
      let retries = 0;
      const pollInterval = setInterval(() => {
        const healthCheckProc = exec("curl -s http://localhost:4444/v1/system/health");
        let healthStdout = "";
        healthCheckProc.stdout?.on("data", (data) => (healthStdout += data));
        healthCheckProc.on("exit", (code) => {
          if (code === 0 && healthStdout) {
            try {
              if (JSON.parse(healthStdout).status === "ok") {
                clearInterval(pollInterval);
                core.info("✅ lsproxy is healthy and ready.");
                isLsproxyReady = true;
                resolve();
                return;
              }
            } catch (e) {
              core.warning(`Failed to parse lsproxy health check response: ${healthStdout}`);
            }
          }
          retries++;
          if (retries > maxRetries) {
            clearInterval(pollInterval);
            core.error("lsproxy did not become healthy in time.");
            proc.kill();
            startupPromise = null; // Allow retrying
            reject(new Error("lsproxy failed to start in time."));
          }
        });
      }, 2000);
    });
  }
  return startupPromise;
}
