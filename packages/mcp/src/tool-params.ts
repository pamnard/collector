/**
 * Zod field builders and Settings catalog projection from schemas.
 * Browser-safe (no Node / host session). Schema is authoritative for
 * `typeLabel` / `required`; agent copy lives in `.describe(...)`.
 */

import { CONTENT_TYPES } from "@collector/shared";
import { z, type ZodRawShape, type ZodTypeAny } from "zod";

const contentTypeSchema = z.enum(CONTENT_TYPES);

/** Zod field builders; pass agent-facing param text to each helper. */
export function createToolParams() {
  return {
    string: (description: string) => z.string().describe(description),
    requiredString: (description: string) =>
      z.string().min(1).describe(description),
    optionalString: (description: string) =>
      z.string().optional().describe(description),
    nullableOptionalString: (description: string) =>
      z.string().nullable().optional().describe(description),
    optionalStringArray: (description: string) =>
      z.array(z.string().min(1)).optional().describe(description),
    requiredInt: (description: string) =>
      z.number().int().describe(description),
    optionalPositiveNumber: (description: string) =>
      z.number().positive().optional().describe(description),
    contentTypeDefaultNote: (description: string) =>
      contentTypeSchema.default("note").describe(description),
    contentTypeOptional: (description: string) =>
      contentTypeSchema.optional().describe(description),
    optionalStringRecord: (description: string) =>
      z.record(z.string()).optional().describe(description),
  };
}

export type ToolParams = ReturnType<typeof createToolParams>;

export interface CollectorMcpToolParam {
  name: string;
  required: boolean;
  typeLabel: string;
  /** Agent-facing param docs; also shown in Settings → MCP. */
  description: string;
}

export interface CollectorMcpToolCatalogEntry {
  name: string;
  description: string;
  params: CollectorMcpToolParam[];
}

export type McpToolDef = {
  name: string;
  description: string;
  buildSchema: (p: ToolParams) => ZodRawShape;
};

function unwrapZod(schema: ZodTypeAny): {
  inner: ZodTypeAny;
  nullable: boolean;
} {
  let current: ZodTypeAny = schema;
  let nullable = false;
  for (;;) {
    const typeName = current._def.typeName as string;
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
      current = current._def.innerType as ZodTypeAny;
      continue;
    }
    if (typeName === "ZodNullable") {
      nullable = true;
      current = current._def.innerType as ZodTypeAny;
      continue;
    }
    if (typeName === "ZodEffects") {
      current = current._def.schema as ZodTypeAny;
      continue;
    }
    break;
  }
  return { inner: current, nullable };
}

function catalogTypeLabel(schema: ZodTypeAny): string {
  const { inner, nullable } = unwrapZod(schema);
  const typeName = inner._def.typeName as string;
  if (typeName === "ZodString") {
    return nullable ? "string | null" : "string";
  }
  if (typeName === "ZodNumber") {
    return "number";
  }
  if (typeName === "ZodEnum" || typeName === "ZodNativeEnum") {
    return "enum";
  }
  if (typeName === "ZodArray") {
    const element = inner._def.type as ZodTypeAny;
    const elementLabel = catalogTypeLabel(element);
    return `${elementLabel}[]`;
  }
  if (typeName === "ZodRecord") {
    return "Record<string, string>";
  }
  throw new Error(`Unsupported MCP param zod type for catalog: ${typeName}`);
}

function catalogParamFromZod(
  name: string,
  schema: ZodTypeAny,
): CollectorMcpToolParam {
  const description = schema.description;
  if (description === undefined || description === "") {
    throw new Error(`MCP param ${name} is missing zod .describe() text`);
  }
  return {
    name,
    required: !schema.isOptional(),
    typeLabel: catalogTypeLabel(schema),
    description,
  };
}

/** Derive Settings / docs params from a tool's zod input shape. */
export function catalogParamsFromShape(
  shape: ZodRawShape,
): CollectorMcpToolParam[] {
  return Object.entries(shape).map(([name, schema]) =>
    catalogParamFromZod(name, schema as ZodTypeAny),
  );
}

/** Browser-safe docs view: names, descriptions, params from zod. */
export function projectToolsCatalog(
  defs: readonly McpToolDef[],
): CollectorMcpToolCatalogEntry[] {
  const params = createToolParams();
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    params: catalogParamsFromShape(def.buildSchema(params)),
  }));
}

export function mediaFileFields(p: ToolParams) {
  return {
    filename: p.optionalString(
      "Original filename including extension (used for type detection and on-disk name). " +
        "Required when dataBase64 is set; optional when sourcePath is set (defaults to basename).",
    ),
    dataBase64: p.optionalString(
      "File bytes as standard base64 (no data: URL prefix). Mutually exclusive with sourcePath.",
    ),
    sourcePath: p.optionalString(
      "Absolute path on the machine running Collector to read bytes from. Mutually exclusive with dataBase64.",
    ),
  };
}

export function mediaReplaceFileFields(p: ToolParams) {
  return {
    filename: p.optionalString(
      "Replacement filename including extension. Required with dataBase64; optional with sourcePath (defaults to basename).",
    ),
    dataBase64: p.optionalString(
      "Replacement file bytes as standard base64. Mutually exclusive with sourcePath.",
    ),
    sourcePath: p.optionalString(
      "Absolute path on the machine running Collector for replacement bytes. Mutually exclusive with dataBase64.",
    ),
  };
}
