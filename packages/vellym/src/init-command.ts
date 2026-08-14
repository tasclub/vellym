import path from "node:path";
import {
  applyProjectSetup,
  planProjectSetup,
  type DevelopmentMethod,
  type ProjectSize,
  type SetupLanguage
} from "@vellym-internal/runtime-node";

export interface InitializeOptions {
  size?: ProjectSize;
  method?: DevelopmentMethod;
  contentRoot?: string;
  language?: SetupLanguage;
}

export async function initializeProject(
  targetArgument?: string,
  options: InitializeOptions = {}
): Promise<void> {
  const missing: string[] = [];
  if (!options.size) missing.push("--size");
  if (!options.method) missing.push("--method");
  if (!options.language) missing.push("--language");
  if (missing.length) {
    throw new Error(`initには次の引数が必要です: ${missing.join(" ")}`);
  }

  const target = path.resolve(targetArgument ?? ".");
  const baseOptions = {
    mode: "recommended" as const,
    size: options.size!,
    method: options.method!,
    level: "strict" as const,
    contentRoot: options.contentRoot ?? "docs",
    language: options.language!
  };
  let plan = await planProjectSetup(target, baseOptions);

  // CLIは対話的な競合解決を行わない。Page候補のpath競合だけをskipし、
  // config/root metadata等の競合は安全のためapply前にエラーとして残す。
  const resolutions = Object.fromEntries(
    plan.files
      .filter((file) => file.templateId && file.status === "conflict")
      .map((file) => [file.templateId!, "skip" as const])
  );
  if (Object.keys(resolutions).length) {
    plan = await planProjectSetup(target, {
      ...baseOptions,
      conflictResolutions: resolutions
    });
  }

  await applyProjectSetup(plan);
  const created = plan.files.filter((file) => file.status === "create");
  const skipped = plan.files.filter((file) => file.status === "skip");
  process.stdout.write(
    `初期化しました: ${target}\n` +
      `作成: ${created.length}件、skip: ${skipped.length}件\n`
  );
  for (const file of skipped) {
    process.stdout.write(`skip: ${file.relativePath}\n`);
  }
}
