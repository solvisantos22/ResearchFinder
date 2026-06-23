import { rmSync } from "node:fs";
import { relative, resolve } from "node:path";

const projectRoot = process.cwd();
const nextDir = resolve(projectRoot, ".next");
const relativeNextDir = relative(projectRoot, nextDir);

if (relativeNextDir.startsWith("..") || relativeNextDir === "") {
  throw new Error(`Refusing to remove unexpected Next.js output path: ${nextDir}`);
}

rmSync(nextDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
