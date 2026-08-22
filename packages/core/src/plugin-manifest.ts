import * as Ajv2020Module from "ajv/dist/2020.js";
import type { Options, ValidateFunction } from "ajv";
import { PLUGIN_MANIFEST_SCHEMA, type PluginManifest } from "@vellym/plugin-api";

const Ajv2020 = Ajv2020Module.default as unknown as new (options?: Options) => {
  compile<T>(schema: object): ValidateFunction<T>;
};

let validator: ValidateFunction<PluginManifest> | undefined;

/**
 * プラグインmanifest（`package.json`の`vellym`フィールド）を検証する。
 *
 * 正本YAMLの未知フィールドを保持する原則はここには及ばない。manifestは
 * Vellymが読むための宣言であり、解釈できない宣言を黙って通すと、
 * 利用者は「入れたのに出てこない」理由を知る手段を失う。
 */
export function validatePluginManifest(value: unknown): {
  manifest?: PluginManifest;
  errors: string[];
} {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    validator = ajv.compile<PluginManifest>(PLUGIN_MANIFEST_SCHEMA);
  }
  if (value === undefined) {
    return { errors: ["manifestがありません"] };
  }
  if (validator(value)) {
    return { manifest: value, errors: [] };
  }
  const errors = (validator.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "不正な値です"}`
  );
  return { errors: errors.length ? errors : ["不正なmanifestです"] };
}
