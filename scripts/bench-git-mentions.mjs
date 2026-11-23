// npm run verify:scale:git — related commits stay fast in a 10,000-commit repository
// (ticket-01m6sy034fzn60bv6ayw7sbg2n). Each of three cold lookups (a different name each time,
// so the server cache never answers) must have a median at or below 500 ms.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const COMMITS = 10_000;
const LIMIT_MS = 500;
const root = await mkdtemp(path.join(tmpdir(), "vellym-bench-git-"));
const names = ["ticket-01bench1", "ticket-01bench2", "ticket-01bench3"];
const write = async (file, text) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
};
const freePort = () => new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

let server;
try {
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  await write(".gitignore", "node_modules\n");
  await write("vellym.config.yaml", 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins:\n  - "@vellym/tickets"\n');
  await write("content/tracker.yaml", "apiVersion: vellym.tasclub.com/v1\nkind: TicketTracker\nmetadata: { name: tracker, title: Work }\nspec:\n  statuses:\n    - { id: open, label: Open, category: open }\n  fields: []\n");
  for (const name of names) {
    await write(`content/+tickets/${name}.yaml`, `apiVersion: vellym.tasclub.com/v1\nkind: Ticket\nmetadata: { name: ${name}, title: ${name} }\nspec:\n  status: open\n`);
  }
  const git = (args, input) => execFileSync("git", args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024 });
  git(["init", "-q"]);
  git(["config", "user.name", "Bench"]);
  git(["config", "user.email", "bench@example.invalid"]);
  git(["add", "."]);
  git(["-c", "commit.gpgSign=false", "commit", "-qm", "Add the project"]);
  // fast-import builds the history in one process. Only the oldest 1,500 commits name the tickets
  // (10 each), so every lookup walks nearly the whole history: the worst case for git log --grep.
  const parent = git(["rev-parse", "HEAD"]).toString().trim();
  let stream = "";
  for (let i = 1; i <= COMMITS; i++) {
    const message = i <= 1500 && i % 50 === 0 ? `Work on ${names[i % names.length]} step ${i}` : `Routine change ${i}`;
    const content = `line ${i}\n`;
    stream += `commit refs/heads/main\nmark :${i}\ncommitter Bench <bench@example.invalid> ${1_700_000_000 + i} +0000\n`;
    stream += `data ${Buffer.byteLength(message)}\n${message}\n`;
    stream += i === 1 ? `from ${parent}\n` : `from :${i - 1}\n`;
    stream += `M 100644 inline src/file.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  }
  git(["fast-import", "--quiet"], stream);
  git(["checkout", "-q", "-f", "main"]);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["packages/vellym/dist/cli.mjs", "dev", "--config", path.join(root, "vellym.config.yaml"), "--port", String(port)]);
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${base}/api/v1/repository`)).ok) break; } catch {}
    if (attempt > 150) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const times = [];
  for (const name of names) {
    const started = performance.now();
    const response = await fetch(`${base}/api/v1/git/mentions?name=${name}&limit=20`);
    const body = await response.json();
    times.push(Math.round(performance.now() - started));
    if (!response.ok || !body.data.available || body.data.commits.length !== 10) {
      throw new Error(`${name}: unexpected response ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
    }
  }
  const median = [...times].sort((a, b) => a - b)[1];
  console.log(JSON.stringify({ commits: COMMITS + 1, timesMs: times, medianMs: median, limitMs: LIMIT_MS }));
  if (median > LIMIT_MS) throw new Error(`related commits median ${median} ms exceeds ${LIMIT_MS} ms`);
} finally {
  server?.kill();
  await rm(root, { recursive: true, force: true });
}
