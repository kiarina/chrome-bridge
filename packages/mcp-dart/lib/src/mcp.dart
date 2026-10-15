import 'dart:convert';

import 'controller.dart';
import 'coordinator.dart';
import 'errors.dart';
import 'generated/contract.g.dart';
import 'registry.dart';
import 'tools.dart';

final _initializeResult = (jsonDecode(mcpInitializeResult) as Map)
    .cast<String, dynamic>();
final _supportedVersions = [
  for (final v in jsonDecode(mcpSupportedProtocolVersions) as List) v as String,
];

/// Tools whose structured output is wrapped as `{"result": ...}` (their
/// output schema says so: lists, strings, unions), the rest give it as is.
final Set<String> _wrapped = {
  for (final t in mcpToolDefinitions)
    if ((t['outputSchema'] as Map?)?['required'] case final List r
        when r.length == 1 && r.first == 'result')
      t['name'] as String,
};

const _pretty = JsonEncoder.withIndent('  ');

/// MCP over Streamable HTTP, stateless with JSON responses (as the Python
/// server runs it): each POST is one JSON-RPC message.
class McpEndpoint {
  McpEndpoint(
    this._controller,
    this._coordinator, {
    required this.operationWait,
  });

  final BrowserController _controller;
  final OperationCoordinator _coordinator;
  final Duration operationWait;

  /// Handles a POST body: the HTTP status and the JSON body (null: none).
  Future<(int, Object?)> handle(String body) async {
    final Object? message;
    try {
      message = jsonDecode(body);
    } on FormatException catch (e) {
      return (400, _error(null, -32700, 'Parse error: ${e.message}'));
    }
    if (message is! Map ||
        message['jsonrpc'] != '2.0' ||
        message['method'] is! String) {
      return (
        400,
        _error(
          null,
          -32602,
          'Validation error: expected one JSON-RPC request or notification',
        ),
      );
    }
    final id = message['id'];
    final method = message['method'] as String;
    final params =
        (message['params'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};
    if (!message.containsKey('id')) return (202, null);
    final Object result;
    switch (method) {
      case 'initialize':
        final requested = params['protocolVersion'];
        result = {
          'protocolVersion': _supportedVersions.contains(requested)
              ? requested
              : mcpFallbackProtocolVersion,
          ..._initializeResult,
        };
      case 'ping':
        result = <String, dynamic>{};
      case 'tools/list':
        result = {'tools': mcpToolDefinitions};
      case 'tools/call':
        result = await _callTool(
          '${params['name']}',
          (params['arguments'] as Map?)?.cast<String, dynamic>() ?? {},
        );
      case 'resources/list':
        result = {'resources': <Object>[]};
      case 'resources/templates/list':
        result = {'resourceTemplates': <Object>[]};
      case 'prompts/list':
        result = {'prompts': <Object>[]};
      default:
        return (200, _error(id, -32601, 'Method not found'));
    }
    return (200, {'jsonrpc': '2.0', 'id': id, 'result': result});
  }

  static Map<String, Object?> _error(Object? id, int code, String message) => {
    'jsonrpc': '2.0',
    'id': id,
    'error': {'code': code, 'message': message},
  };

  static Json _text(String text) => {'text': text, 'type': 'text'};

  Future<Json> _callTool(String name, Json arguments) async {
    if (!isKnownTool(name)) {
      return {
        'content': [_text('Unknown tool: $name')],
        'isError': true,
      };
    }
    try {
      final r = await _coordinator.singleCall(
        () => callMcpTool(_controller, name, arguments),
        timeout: operationWait,
      );
      if (r.image != null) {
        return {
          'content': [
            {'data': r.image, 'mimeType': 'image/png', 'type': 'image'},
          ],
          'isError': false,
        };
      }
      final value = r.value;
      final content = switch (value) {
        final List list => [
          for (final item in list) _text(_pretty.convert(item)),
        ],
        final String s => [_text(s)],
        _ => [_text(_pretty.convert(value))],
      };
      return {
        'content': content,
        'isError': false,
        'structuredContent': _wrapped.contains(name)
            ? {'result': value}
            : value,
      };
    } on ChromeBridgeException catch (e) {
      // The public tool error contract (docs/concepts/api.md); anything else
      // stays a generic error, as in the Python server.
      if (e is ExtensionUnavailableError ||
          e is ExtensionCommandError ||
          e is CoordinatorBusyError ||
          e is InvalidArgumentError) {
        return {
          'content': [_text('Error executing tool $name: ${e.message}')],
          'isError': true,
        };
      }
      return {
        'content': [_text('Error executing tool $name')],
        'isError': true,
      };
    } catch (_) {
      return {
        'content': [_text('Error executing tool $name')],
        'isError': true,
      };
    }
  }
}
