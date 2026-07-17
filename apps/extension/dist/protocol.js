// ../server/src/chrome_bridge_mcp/protocol_v1.schema.json
var protocol_v1_schema_default = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kiarina.github.io/chrome-bridge/protocol/v1.schema.json",
  title: "Chrome Bridge extension protocol v1",
  $ref: "#/$defs/protocolMessage",
  $defs: {
    requestId: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    emptyParams: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    tabIdParams: {
      type: "object",
      properties: { tabId: { type: "integer", minimum: 0 } },
      required: ["tabId"],
      additionalProperties: false
    },
    elementParams: {
      type: "object",
      properties: {
        element: { type: "string", minLength: 1 },
        ref: { type: "string", pattern: "^s[0-9]+e[0-9]+$" }
      },
      required: ["element", "ref"],
      additionalProperties: false
    },
    recordedElementParams: {
      type: "object",
      properties: {
        element: { type: "string", minLength: 1 },
        ref: { type: "string", pattern: "^s[0-9]+e[0-9]+$" },
        videoFilename: { $ref: "#/$defs/recordingFilename" }
      },
      required: ["element", "ref"],
      additionalProperties: false
    },
    uploadParams: {
      type: "object",
      properties: {
        element: { type: "string", minLength: 1 },
        ref: { type: "string", pattern: "^s[0-9]+e[0-9]+$" },
        paths: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 20
        },
        videoFilename: { $ref: "#/$defs/recordingFilename" }
      },
      required: ["element", "ref", "paths"],
      additionalProperties: false
    },
    recordingFilename: {
      type: "string",
      minLength: 1,
      maxLength: 200
    },
    recordVideoParams: {
      type: "object",
      properties: {
        filename: { $ref: "#/$defs/recordingFilename" },
        duration: {
          type: "number",
          minimum: 0.5,
          maximum: 10
        }
      },
      required: ["filename", "duration"],
      additionalProperties: false
    },
    commandRequest: {
      type: "object",
      properties: {
        id: { $ref: "#/$defs/requestId" },
        type: {
          enum: [
            "tabs.list",
            "tabs.open",
            "tabs.close",
            "tabs.select",
            "tabs.activate",
            "page.snapshot",
            "page.click",
            "page.drag",
            "page.hover",
            "page.uploadFile",
            "page.type",
            "page.selectOption",
            "page.pressKey",
            "page.navigate",
            "page.goBack",
            "page.goForward",
            "page.wait",
            "page.screenshot",
            "page.getConsoleLogs",
            "page.recordVideo"
          ]
        },
        params: { type: "object" }
      },
      required: ["id", "type", "params"],
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: { type: { const: "tabs.list" } },
            required: ["type"]
          },
          then: {
            properties: { params: { $ref: "#/$defs/emptyParams" } }
          }
        },
        {
          if: {
            properties: { type: { const: "tabs.open" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: {
                  url: { type: "string", minLength: 1 },
                  active: { type: "boolean" }
                },
                required: ["url", "active"],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: {
              type: { enum: ["tabs.close", "tabs.select", "tabs.activate"] }
            },
            required: ["type"]
          },
          then: {
            properties: { params: { $ref: "#/$defs/tabIdParams" } }
          }
        },
        {
          if: {
            properties: {
              type: {
                enum: [
                  "page.snapshot",
                  "page.goBack",
                  "page.goForward",
                  "page.screenshot",
                  "page.getConsoleLogs"
                ]
              }
            },
            required: ["type"]
          },
          then: {
            properties: { params: { $ref: "#/$defs/emptyParams" } }
          }
        },
        {
          if: {
            properties: { type: { const: "page.click" } },
            required: ["type"]
          },
          then: {
            properties: { params: { $ref: "#/$defs/recordedElementParams" } }
          }
        },
        {
          if: {
            properties: { type: { const: "page.hover" } },
            required: ["type"]
          },
          then: {
            properties: { params: { $ref: "#/$defs/recordedElementParams" } }
          }
        },
        {
          if: {
            properties: { type: { const: "page.uploadFile" } },
            required: ["type"]
          },
          then: {
            properties: { params: { $ref: "#/$defs/uploadParams" } }
          }
        },
        {
          if: {
            properties: { type: { const: "page.drag" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: {
                  startElement: { type: "string", minLength: 1 },
                  startRef: {
                    type: "string",
                    pattern: "^s[0-9]+e[0-9]+$"
                  },
                  endElement: { type: "string", minLength: 1 },
                  endRef: { type: "string", pattern: "^s[0-9]+e[0-9]+$" },
                  videoFilename: { $ref: "#/$defs/recordingFilename" }
                },
                required: [
                  "startElement",
                  "startRef",
                  "endElement",
                  "endRef"
                ],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: { type: { const: "page.type" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: {
                  element: { type: "string", minLength: 1 },
                  ref: { type: "string", pattern: "^s[0-9]+e[0-9]+$" },
                  text: { type: "string" },
                  submit: { type: "boolean" },
                  videoFilename: { $ref: "#/$defs/recordingFilename" }
                },
                required: ["element", "ref", "text", "submit"],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: { type: { const: "page.selectOption" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: {
                  element: { type: "string", minLength: 1 },
                  ref: { type: "string", pattern: "^s[0-9]+e[0-9]+$" },
                  values: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1
                  },
                  videoFilename: { $ref: "#/$defs/recordingFilename" }
                },
                required: ["element", "ref", "values"],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: { type: { const: "page.pressKey" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: {
                  key: { type: "string", minLength: 1 },
                  videoFilename: { $ref: "#/$defs/recordingFilename" }
                },
                required: ["key"],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: { type: { const: "page.navigate" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: { url: { type: "string", minLength: 1 } },
                required: ["url"],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: { type: { const: "page.wait" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: {
                type: "object",
                properties: {
                  time: { type: "number", minimum: 0, maximum: 10 },
                  videoFilename: { $ref: "#/$defs/recordingFilename" }
                },
                required: ["time"],
                additionalProperties: false
              }
            }
          }
        },
        {
          if: {
            properties: { type: { const: "page.recordVideo" } },
            required: ["type"]
          },
          then: {
            properties: {
              params: { $ref: "#/$defs/recordVideoParams" }
            }
          }
        }
      ]
    },
    hello: {
      type: "object",
      properties: {
        type: { const: "hello" },
        protocolVersion: { const: 1 },
        extensionVersion: { type: "string", minLength: 1 }
      },
      required: ["type", "protocolVersion", "extensionVersion"],
      additionalProperties: false
    },
    ping: {
      type: "object",
      properties: { type: { const: "ping" } },
      required: ["type"],
      additionalProperties: false
    },
    pong: {
      type: "object",
      properties: { type: { const: "pong" } },
      required: ["type"],
      additionalProperties: false
    },
    successResponse: {
      type: "object",
      properties: {
        id: { $ref: "#/$defs/requestId" },
        ok: { const: true },
        result: {}
      },
      required: ["id", "ok", "result"],
      additionalProperties: false
    },
    errorResponse: {
      type: "object",
      properties: {
        id: { $ref: "#/$defs/requestId" },
        ok: { const: false },
        error: { type: "string", minLength: 1 }
      },
      required: ["id", "ok", "error"],
      additionalProperties: false
    },
    serverMessage: {
      oneOf: [
        { $ref: "#/$defs/pong" },
        { $ref: "#/$defs/commandRequest" }
      ]
    },
    extensionInitialMessage: { $ref: "#/$defs/hello" },
    extensionRuntimeMessage: {
      oneOf: [
        { $ref: "#/$defs/ping" },
        { $ref: "#/$defs/successResponse" },
        { $ref: "#/$defs/errorResponse" }
      ]
    },
    extensionMessage: {
      oneOf: [
        { $ref: "#/$defs/extensionInitialMessage" },
        { $ref: "#/$defs/extensionRuntimeMessage" }
      ]
    },
    protocolMessage: {
      oneOf: [
        { $ref: "#/$defs/serverMessage" },
        { $ref: "#/$defs/extensionMessage" }
      ]
    }
  }
};

// ../server/src/chrome_bridge_mcp/protocol_v2.schema.json
var protocol_v2_schema_default = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://kiarina.github.io/chrome-bridge/protocol/v2.schema.json",
  title: "Chrome Bridge extension protocol v2 hello",
  $ref: "#/$defs/extensionInitialMessage",
  $defs: {
    browserId: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    },
    hello: {
      type: "object",
      properties: {
        type: { const: "hello" },
        protocolVersion: { const: 2 },
        extensionVersion: { type: "string", minLength: 1 },
        browserId: { $ref: "#/$defs/browserId" },
        browserLabel: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          pattern: "\\S"
        }
      },
      required: [
        "type",
        "protocolVersion",
        "extensionVersion",
        "browserId",
        "browserLabel"
      ],
      additionalProperties: false
    },
    extensionInitialMessage: { $ref: "#/$defs/hello" }
  }
};

// src/protocol.ts
var rootSchema = protocol_v1_schema_default;
var v2RootSchema = protocol_v2_schema_default;
function resolveReference(reference, root) {
  if (!reference.startsWith("#/")) {
    throw new Error(`Unsupported protocol schema reference: ${reference}`);
  }
  let current = root;
  for (const part of reference.slice(2).split("/")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`Invalid protocol schema reference: ${reference}`);
    }
    current = current[part];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error(`Invalid protocol schema reference: ${reference}`);
  }
  return current;
}
function matchesType(value, expected) {
  if (expected === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number")
    return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}
function validate(value, node, path, root) {
  if (typeof node.$ref === "string") {
    return validate(value, resolveReference(node.$ref, root), path, root);
  }
  if (Array.isArray(node.oneOf)) {
    const results = node.oneOf.map(
      (candidate) => validate(value, candidate, path, root)
    );
    if (results.filter((result) => result === null).length !== 1) {
      return `${path} must match exactly one protocol schema`;
    }
  }
  if (Array.isArray(node.allOf)) {
    for (const candidate of node.allOf) {
      const error = validate(value, candidate, path, root);
      if (error) return error;
    }
  }
  if (node.if && typeof node.if === "object") {
    const condition = validate(value, node.if, path, root);
    if (!condition && node.then && typeof node.then === "object") {
      const error = validate(value, node.then, path, root);
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
    if (typeof node.pattern === "string" && !new RegExp(node.pattern).test(value)) {
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
          node.items,
          `${path}[${index}]`,
          root
        );
        if (error) return error;
      }
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value;
    const properties = node.properties && typeof node.properties === "object" ? node.properties : {};
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
        (name) => !Object.hasOwn(properties, name)
      );
      if (extra) return `${path}.${extra} is not allowed`;
    }
  }
  return null;
}
function validateDefinition(value, definition, root = rootSchema) {
  return validate(value, resolveReference(`#/$defs/${definition}`, root), "message", root);
}
function validateServerMessage(value) {
  return validateDefinition(value, "serverMessage");
}
function validateExtensionInitialMessage(value) {
  return validateDefinition(value, "extensionInitialMessage", v2RootSchema);
}
function validateExtensionRuntimeMessage(value) {
  return validateDefinition(value, "extensionRuntimeMessage");
}
function hasValidRequestId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = value.id;
  return typeof id === "string" && !validate(id, resolveReference("#/$defs/requestId", rootSchema), "id", rootSchema);
}
export {
  hasValidRequestId,
  validateExtensionInitialMessage,
  validateExtensionRuntimeMessage,
  validateServerMessage
};
