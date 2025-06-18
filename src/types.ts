export enum BackendCommandType {
  EXECUTE_COMMAND = "execute_command",
  CANCEL_COMMAND = "cancel_command",
  LSPROXY_COMMAND = "lsproxy_command",
  TERMINATE = "terminate",
}

export enum RunnerMessageType {
  RESPONSE = "response",
  LOG = "log",
}

export enum RunnerResponseStatus {
  SUCCESS = "success",
  ERROR = "error",
}

export type LogStreamType = "stdout" | "stderr";
