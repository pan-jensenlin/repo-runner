import { ChildProcess } from "child_process";

const runningProcesses = new Map<string, ChildProcess>();

export { runningProcesses };
