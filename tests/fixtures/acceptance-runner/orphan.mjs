import { spawn } from "node:child_process";
export const steps = [
  { id: "ORPHAN-1", title: "stubborn grandchild", async run(ctx) {
    const grandchild = spawn(process.execPath, ["-e", `
      process.on("SIGTERM", () => {});
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1000);
    `], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((resolve) => grandchild.stdout.once("data", resolve));
    await ctx.fs.writeFile(ctx.path.join(ctx.output, "orphan-pids.json"),
      JSON.stringify({ worker: process.pid, grandchild: grandchild.pid }));
    await new Promise(() => { setInterval(() => {}, 1000); });
  } }
];
