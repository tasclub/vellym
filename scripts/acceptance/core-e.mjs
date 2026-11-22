import { parse, stringify } from "yaml";
import { createCoreWorkspace } from "./lib/core-fixture.mjs";

export const steps = [
  { id: "CORE-MANUAL-A15", title: "ファイル監視の切断と復旧を確認する", async run(ctx) {
    const fixture = await createCoreWorkspace(ctx);
    Object.assign(ctx.state, fixture);
    const { page, origin, root, contentRoot, editPage } = fixture;
    await page.goto(`${origin}/ja/pages/${editPage.name}/`, { waitUntil: "networkidle" });
    await ctx.expect(page.locator("#document-content")).toContainText("受入確認の本文");
    const file = ctx.path.join(root, contentRoot, editPage.relativePath);
    // Observe a real watch delivery before stopping: loading the page alone does
    // not prove that EventSource has opened and recorded a confirmation time.
    const connected = await ctx.check("切断前に外部変更を受信し、監視接続が確立している。", async () => {
      const document = parse(await ctx.fs.readFile(file, "utf8"));
      document.spec.blocks[0].content += "接続確認\n";
      await ctx.fs.writeFile(file, stringify(document));
      await ctx.expect(page.locator("#document-content")).toContainText("接続確認", { timeout: 30000 });
    });
    if (!connected) return;
    await fixture.stop();
    await ctx.check("既に表示している本文が即座に消えない。", () =>
      ctx.expect(page.locator("#document-content")).toContainText("受入確認の本文"));
    await ctx.check("ファイル監視との切断またはerrorが表示される。", () =>
      ctx.expect(page.getByText(/ファイル監視との接続が切れました。|ファイル監視でエラーが発生しました。/)).toBeVisible({ timeout: 30000 }));
    await ctx.check("実際の最終確認時刻が表示される（未確認は認めない）。", async () => {
      const confirmation = page.getByText(/^最終確認 /);
      await ctx.expect(confirmation).toHaveText(/^最終確認 (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d。自動で再接続しています。$/);
      await ctx.expect(confirmation).toBeVisible();
      ctx.note(`切断時の表示: ${await confirmation.innerText()}`);
    });
    await ctx.start(root, { port: Number(new URL(origin).port) });
    await ctx.check("browserを再読み込みせず、自動再接続と復旧通知を確認する。", () =>
      ctx.expect(page.getByText("ファイル監視へ再接続しました")).toBeVisible({ timeout: 30000 }));
    await ctx.check("既知Pageの本文を一語だけ変更し、画面へ反映される。", async () => {
      const document = parse(await ctx.fs.readFile(file, "utf8"));
      document.spec.blocks[0].content += "外部変更\n";
      await ctx.fs.writeFile(file, stringify(document));
      await ctx.expect(page.locator("#document-content")).toContainText("外部変更", { timeout: 30000 });
    });
  } }
];
