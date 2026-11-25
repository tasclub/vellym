export const ROLES = ["overview", "management", "requirements", "architecture", "decisions", "external-design", "internal-design", "development", "quality", "releases", "operations"] as const;
export type Role = typeof ROLES[number];
export type Localized<T> = { ja: T; en: T };
export interface FolderDef {
  id: string;
  role?: Role;
  name: Localized<string>;
  description: Localized<string>;
  children?: FolderDef[];
}
export type FolderTarget = string | { folderId: string; feature: true };
export interface StructureDef {
  id: string;
  numberedByDefault: boolean;
  folders: FolderDef[];
  roleMap: Record<Role, FolderTarget>;
  supplement?: true;
}
export interface DocumentTemplateDef {
  id: string;
  role: Role;
  title: Localized<string>;
  fileName: Localized<string>;
  body: Localized<string>;
  description: Localized<string>;
  alias?: string;
  guideText?: Localized<string>;
}
export interface ResourceTemplateDef {
  id: string;
  pluginId: string;
  group: Localized<string>;
  kind: string;
  fileName: Localized<string>;
  title: Localized<string>;
  description: Localized<string>;
  spec: Localized<Record<string, unknown>>;
  guideText?: Localized<string>;
}
export interface SetDef {
  id: string;
  title: Localized<string>;
  description: Localized<string>;
  items: ({ template: string } | { resource: string })[];
  repeat?: { folderName: Localized<string>; page: string };
}
export interface Catalog {
  structures: StructureDef[];
  templates: DocumentTemplateDef[];
  resources: ResourceTemplateDef[];
  sets: SetDef[];
}
