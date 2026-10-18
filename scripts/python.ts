import { fileURLToPath } from "node:url";

export const pythonExecutable = fileURLToPath(new URL(
  process.platform === "win32" ? "../.venv/Scripts/python.exe" : "../.venv/bin/python",
  import.meta.url,
));
