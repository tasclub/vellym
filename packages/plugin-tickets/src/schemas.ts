/**
 * 種別固有`spec`のJSON Schema。
 *
 * `additionalProperties`を閉じない。プラグインが解釈しないフィールドは
 * 保持されるべきものであり、schemaで弾く対象ではない。ここで閉じると、
 * 正本の非破壊往復とschemaが矛盾する。
 */

export const TICKET_SPEC_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string" },
    fields: { type: "object" },
    blocks: { type: "array" }
  },
  additionalProperties: true
} as const;

export const TICKET_TRACKER_SPEC_SCHEMA = {
  type: "object",
  properties: {
    statuses: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "category"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          category: { enum: ["open", "closed"] }
        },
        additionalProperties: true
      }
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "type"],
        properties: {
          id: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          type: {
            enum: [
              "text",
              "multiline",
              "number",
              "boolean",
              "date",
              "select",
              "multiselect",
              "reference"
            ]
          },
          required: { type: "boolean" },
          listColumn: { type: "boolean" },
          options: {
            type: "array",
            items: {
              type: "object",
              required: ["value", "label"],
              properties: {
                value: { type: "string" },
                label: { type: "string" }
              },
              additionalProperties: true
            }
          }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
} as const;
