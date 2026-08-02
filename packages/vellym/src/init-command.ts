import path from "node:path";
import {
  checkbox,
  confirm,
  input,
  select
} from "@inquirer/prompts";
import {
  applyProjectSetup,
  planProjectSetup,
  setupManifest,
  type SetupLanguage,
  type SetupProfileId
} from "@vellym-internal/runtime-node";

export interface InitializeOptions {
  planOnly?: boolean;
  json?: boolean;
  yes?: boolean;
  profiles?: SetupProfileId[];
  contentRoot?: string;
  language?: SetupLanguage;
  templateIds?: string[];
}

export async function initializeProject(
  targetArgument?: string,
  options: InitializeOptions = {}
): Promise<void> {
  const target = path.resolve(targetArgument ?? ".");
  let profiles = options.profiles;
  let contentRoot = options.contentRoot;
  let language = options.language;
  let folderNames: Record<string, string> | undefined;
  let selectedTemplateIds = options.templateIds;
  if (process.stdin.isTTY && !options.yes) {
    const selectedLanguage = await select({
      message: "UIと初期文書の言語",
      choices: [
        { name: "日本語", value: "ja" as const },
        { name: "English", value: "en" as const }
      ],
      default: language ?? "ja"
    });
    language = selectedLanguage as SetupLanguage;
    const selectedRoot = await input({
      message: "content root（project rootからの相対path）",
      default: contentRoot ?? "docs"
    });
    contentRoot = String(selectedRoot);
    const manifest = setupManifest();
    const selectedProfiles = await checkbox({
      message: "初期profile",
      choices: manifest.profiles.map((profile) => ({
        name: profile.title,
        value: profile.id,
        checked: profile.id === "software-basic"
      })),
      required: true
    });
    profiles = selectedProfiles as SetupProfileId[];
    folderNames = language === "ja" ? {
      project: "プロジェクト",
      requirements: "要求",
      decisions: "設計判断",
      architecture: "アーキテクチャ",
      "project-management": "プロジェクト管理"
    } : {
      project: "project",
      requirements: "requirements",
      decisions: "decisions",
      architecture: "architecture",
      "project-management": "project-management"
    };
    for (const [id, initial] of Object.entries(folderNames)) {
      const value = await input({ message: `${id}フォルダ名`, default: initial });
      folderNames[id] = String(value);
    }
    const available = new Set(
      manifest.profiles
        .filter((profile) => profiles!.includes(profile.id))
        .flatMap((profile) => profile.templateIds)
    );
    const selectedPages = await checkbox({
      message: "作成する文書",
      choices: manifest.templates
        .filter((template) => available.has(template.id))
        .map((template) => ({
          name: template.title,
          value: template.id,
          checked:
            selectedTemplateIds?.includes(template.id) ??
            template.defaultSelected !== false
        }))
    });
    selectedTemplateIds = selectedPages as string[];
  } else if (
    !process.stdin.isTTY &&
    (!options.planOnly && !options.yes ||
      !profiles?.length ||
      !contentRoot ||
      !language)
  ) {
    // 不足しているフラグを名指しして、何を足せばよいか分かるようにする。
    const missing: string[] = [];
    if (!options.planOnly && !options.yes) missing.push("--yes");
    if (!language) missing.push("--language");
    if (!contentRoot) missing.push("--content-root");
    if (!profiles?.length) missing.push("--profile");
    throw new Error(
      `非対話実行では次のフラグが必要です: ${missing.join(" ")}`
    );
  }
  const plan = await planProjectSetup(target, {
    profiles,
    selectedTemplateIds,
    contentRoot,
    language,
    folderNames
  });
  if (options.planOnly) {
    process.stdout.write(
      options.json
        ? `${JSON.stringify({ schemaVersion: "1.0", data: plan, diagnostics: [] }, null, 2)}\n`
        : `初期化予定: ${plan.files.filter((file) => file.status === "create").length}件、競合${plan.files.filter((file) => file.status === "conflict").length}件\n`
    );
    return;
  }
  if (process.stdin.isTTY && !options.yes) {
    process.stdout.write(
      `\n作成予定: ${plan.files.filter((file) => file.status === "create").length}件\n` +
      `project root: ${plan.projectRoot}\ncontent root: ${plan.contentRoot}\n`
    );
    const accepted = await confirm({ message: "この内容で初期化しますか？", default: true });
    if (!accepted) {
      process.stdout.write("初期化をキャンセルしました\n");
      return;
    }
  }
  await applyProjectSetup(plan);
  process.stdout.write(`初期化しました: ${target}\n`);
}
