declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  loadEnvFile?: (path?: string) => void;
};
