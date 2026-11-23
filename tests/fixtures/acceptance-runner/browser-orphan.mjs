import { open } from "./browser.mjs";
export const steps = [
  { id: "BROWSER-ORPHAN-1", title: "stop the browser and server with the group", async run(ctx) {
    const { server } = await open(ctx);
    const processes = [];
    for (const entry of await ctx.fs.readdir("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = await ctx.fs.readFile(`/proc/${entry}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const command = (await ctx.fs.readFile(`/proc/${entry}/cmdline`, "utf8")).replaceAll("\0", " ");
        processes.push({ pid: Number(entry), ppid: Number(fields[1]), group: Number(fields[2]), command });
      } catch {}
    }
    const descendants = new Set([process.pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const member of processes) {
        if (!descendants.has(member.pid) && descendants.has(member.ppid)) {
          descendants.add(member.pid);
          changed = true;
        }
      }
    }
    const members = processes.filter((member) => descendants.has(member.pid));
    ctx.expect(members.every((member) => member.group === process.pid)).toBe(true);
    ctx.expect(members.some((member) => member.pid === server.server.pid)).toBe(true);
    ctx.expect(members.some((member) => /headless_shell/.test(member.command))).toBe(true);
    await ctx.fs.writeFile(ctx.path.join(ctx.output, "browser-pids.json"), JSON.stringify(members));
    await new Promise(() => { setInterval(() => {}, 1000); });
  } }
];
