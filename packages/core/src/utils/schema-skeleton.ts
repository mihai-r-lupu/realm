// Generates a minimal conforming skeleton from a JSON Schema object.
// Used to populate call_with placeholders in NextAction instructions.

type JsonSchema = Record<string, unknown>;

/**
 * Returns a minimal skeleton value for the given JSON Schema.
 * Only required properties are included for object types.
 * Enums produce a "<val1|val2>" placeholder string.
 * Arrays produce a one-element array of the item skeleton.
 * Nested objects are recursed.
 */
export function generateSchemaSkeleton(schema: JsonSchema): unknown {
  const type = schema['type'];
  const properties = schema['properties'] as Record<string, JsonSchema> | undefined;

  if (type === 'object' || (type === undefined && properties !== undefined)) {
    if (properties === undefined) return {};
    const required = (schema['required'] as string[] | undefined) ?? Object.keys(properties);
    const result: Record<string, unknown> = {};
    for (const key of required) {
      const propSchema = properties[key];
      if (propSchema !== undefined) {
        result[key] = generateSchemaSkeleton(propSchema);
      }
    }
    return result;
  }

  if (type === 'array') {
    const items = schema['items'] as JsonSchema | undefined;
    return items !== undefined ? [generateSchemaSkeleton(items)] : [];
  }

  if (type === 'string') {
    const enumValues = schema['enum'] as string[] | undefined;
    return enumValues !== undefined ? `<${enumValues.join('|')}>` : '';
  }

  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;

  return null;
}
