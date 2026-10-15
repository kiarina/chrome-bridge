import 'dart:convert';

import 'controller.dart';
import 'errors.dart';
import 'generated/contract.g.dart';
import 'registry.dart';

/// The Direct API tool definitions (`/api/v1/tools`), the Python server's.
final List<Json> directToolDefinitions = [
  for (final t in jsonDecode(directTools) as List)
    (t as Map).cast<String, dynamic>(),
];

/// The MCP tool list (`tools/list`), the Python server's.
final List<Json> mcpToolDefinitions = [
  for (final t in jsonDecode(mcpTools) as List)
    (t as Map).cast<String, dynamic>(),
];

final Map<String, Json> _inputSchemas = {
  for (final t in directToolDefinitions)
    t['name'] as String: (t['inputSchema'] as Map).cast<String, dynamic>(),
};

bool isKnownTool(String name) => _inputSchemas.containsKey(name);

/// [raw] checked against [tool]'s input schema, with its defaults filled in.
/// Unknown arguments are ignored, as the Python server does.
Json parseArguments(String tool, Json raw) {
  final schema = _inputSchemas[tool];
  if (schema == null) {
    throw MethodNotFoundError('Unknown browser method: $tool');
  }
  final properties = (schema['properties'] as Map? ?? const {})
      .cast<String, dynamic>();
  final required = [
    for (final r in schema['required'] as List? ?? const []) r as String,
  ];
  final out = <String, dynamic>{};
  for (final entry in properties.entries) {
    final name = entry.key;
    final spec = (entry.value as Map).cast<String, dynamic>();
    if (!raw.containsKey(name)) {
      if (required.contains(name)) {
        throw InvalidArgumentError('$tool: $name is required');
      }
      out[name] = spec['default'];
      continue;
    }
    out[name] = _coerce(tool, name, spec, raw[name]);
  }
  return out;
}

Object? _coerce(String tool, String name, Json spec, Object? value) {
  final anyOf = spec['anyOf'] as List?;
  if (anyOf != null) {
    for (final option in anyOf) {
      try {
        return _coerce(
          tool,
          name,
          (option as Map).cast<String, dynamic>(),
          value,
        );
      } on InvalidArgumentError {
        continue;
      }
    }
    throw InvalidArgumentError('$tool: $name has an invalid value');
  }
  Never bad(String kind) =>
      throw InvalidArgumentError('$tool: $name must be $kind');
  switch (spec['type']) {
    case 'null':
      return value == null ? null : bad('null');
    case 'string':
      return value is String ? value : bad('a string');
    case 'boolean':
      return value is bool ? value : bad('a boolean');
    case 'integer':
      if (value is int) return value;
      if (value is double && value.isFinite && value == value.roundToDouble()) {
        return value.toInt();
      }
      return bad('an integer');
    case 'number':
      return value is num && value is! bool ? value : bad('a number');
    case 'array':
      if (value is! List) return bad('an array');
      final items = (spec['items'] as Map?)?.cast<String, dynamic>();
      return [
        for (final item in value)
          items == null ? item : _coerce(tool, name, items, item),
      ];
  }
  return value;
}

/// Runs the Direct API method [method] with its parsed arguments: the
/// result as the Direct API returns it.
Future<Object?> callDirect(BrowserController c, String method, Json raw) async {
  final a = parseArguments(method, raw);
  final browserId = a['browser_id'] as String?;
  final video = a['video_filename'] as String?;
  switch (method) {
    case 'browser_instances':
      return c.instances();
    case 'browser_screenshot':
      return c.screenshotResult(browserId);
    case 'browser_get_console_logs':
      return c.consoleLogs(browserId);
    case 'browser_press_key':
      return c.pressKeyResult(a['key'] as String, browserId, video);
    case 'browser_wait':
      return c.waitResult(a['time'] as num, browserId, video);
  }
  return _common(c, method, a, browserId, video);
}

/// The result of an MCP tool: what the tool returns ([value]), or the PNG
/// image (base64) of `browser_screenshot`.
typedef McpToolResult = ({Object? value, String? image});

/// Runs the MCP tool [name]: its result as MCP shows it.
Future<McpToolResult> callMcpTool(
  BrowserController c,
  String name,
  Json raw,
) async {
  final a = parseArguments(name, raw);
  final browserId = a['browser_id'] as String?;
  final video = a['video_filename'] as String?;
  switch (name) {
    case 'browser_instances':
      return (value: c.instances(), image: null);
    case 'browser_screenshot':
      return (
        value: null,
        image: (await c.screenshotResult(browserId))['data'] as String,
      );
    case 'browser_get_console_logs':
      final entries = await c.consoleLogs(browserId);
      return (value: entries.map(jsonEncode).join('\n'), image: null);
    case 'browser_press_key':
      return (
        value: await c.pressKey(a['key'] as String, browserId, video),
        image: null,
      );
    case 'browser_wait':
      return (
        value: await c.wait(a['time'] as num, browserId, video),
        image: null,
      );
  }
  return (value: await _common(c, name, a, browserId, video), image: null);
}

Future<Object?> _common(
  BrowserController c,
  String method,
  Json a,
  String? browserId,
  String? video,
) {
  List<String> strings(Object? v) => [for (final x in v as List) x as String];
  switch (method) {
    case 'browser_tabs':
      return c.listTabs(browserId);
    case 'browser_tab_open':
      return c.openTab(a['url'] as String, a['active'] as bool, browserId);
    case 'browser_tab_close':
      return c.closeTab(a['tab_id'] as int, browserId);
    case 'browser_tab_select':
      return c.selectTab(a['tab_id'] as int, browserId);
    case 'browser_tab_activate':
      return c.activateTab(a['tab_id'] as int, browserId);
    case 'browser_snapshot':
      return c.snapshot(browserId);
    case 'browser_dialog_respond':
      return c.respondToDialog(
        a['dialog_ref'] as String,
        a['action'] as String,
        a['prompt_text'] as String?,
        browserId,
      );
    case 'browser_click':
      return c.click(
        a['element'] as String,
        a['ref'] as String,
        browserId,
        video,
      );
    case 'browser_hover':
      return c.hover(
        a['element'] as String,
        a['ref'] as String,
        browserId,
        video,
      );
    case 'browser_drag':
      return c.drag(
        a['startElement'] as String,
        a['startRef'] as String,
        a['endElement'] as String,
        a['endRef'] as String,
        browserId,
        video,
      );
    case 'browser_upload_file':
      return c.uploadFiles(
        a['element'] as String,
        a['ref'] as String,
        strings(a['paths']),
        browserId,
        video,
      );
    case 'browser_type':
      return c.typeText(
        a['element'] as String,
        a['ref'] as String,
        a['text'] as String,
        a['submit'] as bool,
        browserId,
        video,
      );
    case 'browser_select_option':
      return c.selectOption(
        a['element'] as String,
        a['ref'] as String,
        strings(a['values']),
        browserId,
        video,
      );
    case 'browser_navigate':
      return c.navigate(a['url'] as String, browserId, video);
    case 'browser_go_back':
      return c.goBack(browserId, video);
    case 'browser_go_forward':
      return c.goForward(browserId, video);
    case 'browser_wait_for':
      return c.waitFor(
        a['text'] as String,
        a['state'] as String,
        a['timeout'] as num,
        browserId,
        video,
      );
    case 'browser_download_file':
      return c.downloadFile(
        a['element'] as String,
        a['ref'] as String,
        a['timeout'] as num,
        browserId,
      );
    case 'browser_record_video':
      return c.recordVideo(
        a['filename'] as String,
        a['duration'] as num,
        browserId,
      );
  }
  throw MethodNotFoundError('Unknown browser method: $method');
}
