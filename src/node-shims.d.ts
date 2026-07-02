declare module "node:child_process" {
  export function execFile(...args: unknown[]): void;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

declare module "node:path" {
  export function dirname(path: string): string;
}

declare module "node:util" {
  export function promisify(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => Promise<any>;
}

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  exit(code?: number): never;
  loadEnvFile?: (path?: string) => void;
};
