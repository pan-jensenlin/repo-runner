export enum TestingRunType {
  SCHEDULED_RUN = "scheduled_run",
  TESTING_COMMIT_CHECK_RUN = "testing_commit_check_run",
}

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
  READ_SOURCE_CODE = "read-source-code",
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

export interface Range {
  start: Position;
  end: Position;
}

export interface FileRange {
  path: string;
  range: Range;
}

export interface Position {
  line: number;
  character: number;
}

export interface FilePosition {
  path: string;
  position: Position;
}

export interface GetDefinitionParams extends FilePosition {}

export interface GetReferencesParams {
  identifier_position: FilePosition;
  include_code_context_lines?: number;
}

export interface GetDefinitionsInFileParams {
  path: string;
}

export interface ReadSourceCodeParams extends FileRange {}

export type LsproxyMessageParams =
  | { action: LsproxyAction.START; actionParams?: never }
  | { action: LsproxyAction.LIST_FILES; actionParams?: never }
  | { action: LsproxyAction.GET_DEFINITION; actionParams: GetDefinitionParams }
  | { action: LsproxyAction.GET_REFERENCES; actionParams: GetReferencesParams }
  | {
      action: LsproxyAction.GET_DEFINITIONS_IN_FILE;
      actionParams: GetDefinitionsInFileParams;
    }
  | { action: LsproxyAction.READ_SOURCE_CODE; actionParams: ReadSourceCodeParams };
