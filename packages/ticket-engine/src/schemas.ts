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
    ticketTemplate: {
      anyOf: [
        { type: "string" },
        { type: "object", minProperties: 1, additionalProperties: { type: "string" } }
      ]
    },
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
          filter: { type: "boolean" },
          sort: { type: "boolean" },
          // reference専用の修飾。他の型で書くとvalidateで警告になる
          multiple: { type: "boolean" },
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
    },
    rules: {
      type: "array", items: { type: "object", properties: {
        id: { type: "string" },
        when: { type: "object", properties: { status: { type: "array", items: { type: "string" } }, statusCategory: { enum: ["open", "closed"] } }, additionalProperties: true },
        require: { type: "array", items: { type: "string" } },
        empty: { type: "array", items: { type: "string" } },
        equals: { type: "object", additionalProperties: { anyOf: [{ type: ["string", "number", "boolean"] }, { type: "array", items: { type: ["string", "number", "boolean"] } }] } },
        message: { type: "object", additionalProperties: { type: "string" } }
      }, anyOf: [{ required: ["require"] }, { required: ["equals"] }, { required: ["empty"] }], additionalProperties: true }
    },
    defaultSort: {
      type: "object",
      required: ["field"],
      properties: {
        field: { type: "string", minLength: 1 },
        direction: { enum: ["asc", "desc"] }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
} as const;
