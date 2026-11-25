import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const cli = path.resolve("packages/vellym/dist/cli.mjs");

it.each([false, true])("dev bind defaults (explicit public host: %s)", async (publicHost) => {
  const root = await mkdtemp(path.join(tmpdir(), "vellym-bind-"));
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  const args = [cli, "dev", "--port", String(port), "--language", "en", ...(publicHost ? ["--host", "0.0.0.0"] : [])];
  const child = spawn(process.execPath, args, { cwd: root });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    let connected = false;
    for (let i = 0; i < 150; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/bootstrap`);
        if (response.ok) { connected = true; break; }
      } catch { /* still starting */ }
      if (child.exitCode !== null) throw new Error(`dev exited: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(connected).toBe(true);
    if (publicHost) {
      expect(output).toMatch(/0\.0\.0\.0/);
      expect(output).toMatch(/expos|public|network|warning/i);
    } else {
      expect(output).toContain(`http://127.0.0.1:${port}`);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
