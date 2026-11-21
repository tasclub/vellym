export async function open(ctx) {
    const root = await ctx.temporary("runner-browser");
    const initialized = ctx.cli(root, "init", "--size", "personal", "--method", "hybrid", "--level", "light", "--language", "ja");
    ctx.expect(initialized.status, initialized.stderr).toBe(0);
    const server = await ctx.start(root);
    const page = await ctx.page(server.origin);
    await page.goto(server.origin);
    ctx.expect(await page.title()).toBeTruthy();
    return { server, page };
}
export const steps = [
  { id: "BROWSER-1", title: "browser and server lifecycle", async run(ctx) {
    const { server } = await open(ctx);
    await server.stop();
  } }
];
