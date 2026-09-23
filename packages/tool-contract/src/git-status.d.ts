export interface GitStatusData {
  entries: Array<{
    path: string;
    indexStatus: string;
    worktreeStatus: string;
    originalPath?: string;
  }>;
}

interface Envelope {
  invocationId: string;
  toolId: string;
  version: string;
  durationMs: number;
}

export type GitStatusResult = Envelope &
  (
    | { status: "success"; complete: true; data: GitStatusData }
    | {
        status: "error" | "cancelled";
        complete: false;
        error: { code: string; message: string };
      }
  );

export function executeGitStatus(options: {
  args: unknown;
  workspace?: string;
  resolveWorkspace?: () => Promise<string>;
  enabled: boolean | (() => Promise<boolean>);
  signal?: AbortSignal;
  invocationId?: string;
}): Promise<GitStatusResult>;

export function parseStatus(buffer: Uint8Array): GitStatusData;
export function readGitStatus(
  workspace: string,
  limits: { timeoutMs: number; maxOutputBytes: number },
  signal?: AbortSignal,
): Promise<GitStatusData>;
export function gitStatusRegistry(enabled?: boolean): {
  manifest: {
    id: string;
    name: string;
    displayName: string;
    version: string;
    limits: { timeoutMs: number; maxOutputBytes: number };
  };
  registry: {
    definitions(): Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    setEnabled(id: string, enabled: boolean): void;
    validateCall(name: string, args: unknown): unknown;
    validateResult(id: string, data: unknown): unknown;
  };
};
