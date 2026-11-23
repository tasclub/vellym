export const steps = [
  { id: "PASS-1", title: "first pass", async run(ctx) {
    if (Object.keys(ctx.state).length) throw new Error("state leaked between modules");
    ctx.state.pass = true;
    await ctx.check("passing assertion", async () => ctx.expect(2 + 2).toBe(4));
    console.log("fixture non-JSON output");
  } },
  { id: "PASS-2", title: "second pass", async run(ctx) {
    ctx.expect(ctx.state.pass).toBe(true);
  } }
];
