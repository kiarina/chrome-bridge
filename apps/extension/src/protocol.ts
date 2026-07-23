import schemaV1 from "../../../packages/mcp/src/chrome_bridge_mcp/protocol_v1.schema.json";
import schemaV2 from "../../../packages/mcp/src/chrome_bridge_mcp/protocol_v2.schema.json";

type JsonSchema = Record<string, unknown>;

const rootSchema = schemaV1 as JsonSchema;
const v2RootSchema = schemaV2 as JsonSchema;

function resolveReference(reference: string, root: JsonSchema): JsonSchema {
  if (!reference.startsWith("#/")) {
    throw new Error(`Unsupported protocol schema reference: ${reference}`);
  }
  let current: unknown = root;
  for (const part of reference.slice(2).split("/")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`Invalid protocol schema reference: ${reference}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error(`Invalid protocol schema reference: ${reference}`);
  }
  return current as JsonSchema;
}

function matchesType(value: unknown, expected: unknown): boolean {
  if (expected === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number")
    return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}

function validate(
  value: unknown,
  node: JsonSchema,
  path: string,
  root: JsonSchema,
): string | null {
  if (typeof node.$ref === "string") {
    return validate(value, resolveReference(node.$ref, root), path, root);
  }
  if (Array.isArray(node.oneOf)) {
    const results = node.oneOf.map((candidate) =>
      validate(value, candidate as JsonSchema, path, root),
    );
    if (results.filter((result) => result === null).length !== 1) {
      return `${path} must match exactly one protocol schema`;
    }
  }
  if (Array.isArray(node.allOf)) {
    for (const candidate of node.allOf) {
      const error = validate(value, candidate as JsonSchema, path, root);
      if (error) return error;
    }
  }
  if (node.if && typeof node.if === "object") {
    const condition = validate(value, node.if as JsonSchema, path, root);
    if (!condition && node.then && typeof node.then === "object") {
      const error = validate(value, node.then as JsonSchema, path, root);
      if (error) return error;
    }
  }
  if (Object.hasOwn(node, "const") && value !== node.const) {
    return `${path} must equal ${JSON.stringify(node.const)}`;
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    return `${path} is not an allowed value`;
  }
  if (node.type && !matchesType(value, node.type)) {
    return `${path} must be ${String(node.type)}`;
  }

  if (typeof value === "string") {
    if (typeof node.minLength === "number" && value.length < node.minLength) {
      return `${path} is too short`;
    }
    if (typeof node.maxLength === "number" && value.length > node.maxLength) {
      return `${path} is too long`;
    }
    if (
      typeof node.pattern === "string" &&
      !new RegExp(node.pattern).test(value)
    ) {
      return `${path} has an invalid format`;
    }
  }
  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) {
      return `${path} is below the minimum`;
    }
    if (typeof node.maximum === "number" && value > node.maximum) {
      return `${path} is above the maximum`;
    }
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === "number" && value.length < node.minItems) {
      return `${path} has too few items`;
    }
    if (node.items && typeof node.items === "object") {
      for (const [index, item] of value.entries()) {
        const error = validate(
          item,
          node.items as JsonSchema,
          `${path}[${index}]`,
          root,
        );
        if (error) return error;
      }
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties =
      node.properties && typeof node.properties === "object"
        ? (node.properties as Record<string, JsonSchema>)
        : {};
    if (Array.isArray(node.required)) {
      for (const name of node.required) {
        if (typeof name === "string" && !Object.hasOwn(record, name)) {
          return `${path}.${name} is required`;
        }
      }
    }
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(record, name)) continue;
      const error = validate(record[name], propertySchema, `${path}.${name}`, root);
      if (error) return error;
    }
    if (node.additionalProperties === false) {
      const extra = Object.keys(record).find(
        (name) => !Object.hasOwn(properties, name),
      );
      if (extra) return `${path}.${extra} is not allowed`;
    }
  }
  return null;
}

function validateDefinition(
  value: unknown,
  definition: string,
  root: JsonSchema = rootSchema,
): string | null {
  return validate(value, resolveReference(`#/$defs/${definition}`, root), "message", root);
}

export function validateServerMessage(value: unknown): string | null {
  return validateDefinition(value, "serverMessage");
}

export function validateExtensionInitialMessage(value: unknown): string | null {
  return validateDefinition(value, "extensionInitialMessage", v2RootSchema);
}

export function validateExtensionRuntimeMessage(value: unknown): string | null {
  return validateDefinition(value, "extensionRuntimeMessage");
}

export function hasValidRequestId(value: unknown): value is { id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = (value as Record<string, unknown>).id;
  return (
    typeof id === "string" &&
    !validate(id, resolveReference("#/$defs/requestId", rootSchema), "id", rootSchema)
  );
}
