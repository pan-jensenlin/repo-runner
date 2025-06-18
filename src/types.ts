export enum BackendCommandType {
  EXECUTE_COMMAND = "execute_command",
  CANCEL_COMMAND = "cancel_command",
  LSPROXY_COMMAND = "lsproxy_command",
  TERMINATE = "terminate",
}

export enum LsproxyAction {
  START = "start",
  LIST_FILES = "list-files",
  GET_DEFINITION = "get-definition",
  GET_REFERENCES = "get-references",
  GET_DEFINITIONS_IN_FILE = "get-definitions-in-file",
}

export enum RunnerMessageType {
  RESPONSE = "response",
  LOG = "log",
}

export enum RunnerResponseStatus {
  SUCCESS = "success",
  ERROR = "error",
}

export type LogStreamType = "stdout" | "stderr" | "lsproxy-out" | "lsproxy-err";
