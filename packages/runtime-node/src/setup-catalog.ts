/**
 * Axes shared by the setup pack, the recommender, and the wizard. The pack data
 * itself lives in `setup-packs/` and is loaded through `setup-pack.ts`.
 */
export type ProjectSize = "personal" | "small-team" | "medium-large";
export type DevelopmentMethod = "agile" | "hybrid" | "waterfall";
export type DocumentationLevel = "light" | "standard" | "strict";
export type SetupRequiredness = "core" | "recommended" | "conditional" | "optional";

/**
 * How the user started the wizard. The wire values predate the hierarchy
 * change: `templates` is the "pick folders and pages yourself" route.
 */
export type SetupMode = "recommended" | "templates" | "empty";

export interface LocalizedSetupText {
  ja: string;
  en: string;
}
