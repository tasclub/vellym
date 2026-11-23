export const steps = [
  { id: "HANG-1", title: "never resolves", async run() { await new Promise(() => { setInterval(() => {}, 1000); }); } },
  { id: "HANG-2", title: "must not execute", async run() { throw new Error("Should not run"); } }
];
