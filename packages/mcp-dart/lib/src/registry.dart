import 'dart:async';
import 'dart:developer' as developer;

import 'errors.dart';
import 'ids.dart';
import 'protocol.dart';

typedef Json = Map<String, dynamic>;

/// How long the ID of a command that timed out is remembered: an answer the
/// extension sends that late is ignored instead of breaking the connection.
const lateAnswerWindow = Duration(seconds: 120);

/// The extension's end of one WebSocket.
abstract interface class ExtensionSocket {
  void sendJson(Object message);
  Future<void> close(int code, String reason);
}

/// One connected extension (one Chrome profile): sends it commands and
/// matches its answers to them.
class BrowserConnection {
  BrowserConnection(
    this.socket, {
    required this.browserId,
    required this.label,
    required this.protocolVersion,
    required this.extensionVersion,
    required this.identityStable,
    required Duration timeout,
  }) : _timeout = timeout;

  final ExtensionSocket socket;
  final String browserId;
  final String label;
  final int protocolVersion;
  final String extensionVersion;
  final bool identityStable;
  final Duration _timeout;
  final _pending = <String, Completer<Object?>>{};
  final _timedOut = <String, DateTime>{};

  Json asJson() => {
    'browserId': browserId,
    'label': label,
    'protocolVersion': protocolVersion,
    'extensionVersion': extensionVersion,
    'identityStable': identityStable,
  };

  Future<void> disconnect(
    ExtensionUnavailableError error, {
    bool close = false,
  }) async {
    for (final c in _pending.values) {
      if (!c.isCompleted) c.completeError(error);
    }
    _pending.clear();
    if (close) {
      await socket.close(1012, 'Replaced by a newer extension connection');
    }
  }

  /// Sends [command] with [params] and waits for its result (the default
  /// timeout unless [timeout]).
  Future<Object?> request(
    String command,
    Json params, {
    Duration? timeout,
  }) async {
    final id = uuid4();
    final message = {'id': id, 'type': command, 'params': params};
    validateServerMessage(message);
    final completer = Completer<Object?>();
    _pending[id] = completer;
    try {
      socket.sendJson(message);
      return await completer.future.timeout(
        timeout ?? _timeout,
        onTimeout: () {
          _rememberTimedOut(id);
          throw ExtensionCommandError(
            'Chrome extension timed out while running $command',
          );
        },
      );
    } finally {
      _pending.remove(id);
    }
  }

  void _rememberTimedOut(String id) {
    final now = DateTime.now();
    _timedOut.removeWhere((_, at) => now.difference(at) > lateAnswerWindow);
    _timedOut[id] = now;
  }

  /// Handles a message from the extension: a reply to send back (`pong`), or
  /// null.
  Json? receive(Json message) {
    validateExtensionRuntimeMessage(message);
    if (message['type'] == 'ping') return {'type': 'pong'};
    final id = message['id'];
    if (id is! String) return null;
    final completer = _pending[id];
    if (completer == null || completer.isCompleted) {
      if (_timedOut.remove(id) != null) {
        // The command already failed as timed out; the late answer changes
        // nothing, and the connection stays usable.
        developer.log(
          'Ignored a late extension answer to $id',
          name: 'chrome_bridge_mcp',
        );
        return null;
      }
      throw ProtocolValidationError('Unknown response id: $id');
    }
    if (message['ok'] == true) {
      completer.complete(message['result']);
    } else {
      completer.completeError(
        ExtensionCommandError(
          '${message['error'] ?? 'Extension command failed'}',
        ),
      );
    }
    return null;
  }
}

/// The connected extensions by browser ID. A protocol v1 extension has no
/// stable identity and gets one legacy slot.
class BrowserRegistry {
  BrowserRegistry({this.timeout = const Duration(seconds: 15)});

  final Duration timeout;
  final _connections = <String, BrowserConnection>{};
  String? _legacyBrowserId;

  bool get connected => _connections.isNotEmpty;
  int get connectedCount => _connections.length;

  Json get extensionInfo {
    if (_connections.length != 1) return {};
    final c = _connections.values.single;
    return {
      'protocolVersion': c.protocolVersion,
      'extensionVersion': c.extensionVersion,
    };
  }

  List<Json> instances() => [
    for (final c
        in (_connections.values.toList()
          ..sort((a, b) => a.browserId.compareTo(b.browserId))))
      c.asJson(),
  ];

  Future<BrowserConnection> attach(ExtensionSocket socket, Json hello) async {
    final protocolVersion = (hello['protocolVersion'] as num).toInt();
    final identityStable = protocolVersion == 2;
    final browserId = identityStable ? '${hello['browserId']}' : uuid4();
    final label = identityStable
        ? '${hello['browserLabel']}'
        : 'Legacy browser';
    final connection = BrowserConnection(
      socket,
      browserId: browserId,
      label: label,
      protocolVersion: protocolVersion,
      extensionVersion: '${hello['extensionVersion']}',
      identityStable: identityStable,
      timeout: timeout,
    );
    final replacedId = identityStable ? browserId : _legacyBrowserId;
    final previous = replacedId == null ? null : _connections[replacedId];
    if (previous != null) _connections.remove(previous.browserId);
    _connections[browserId] = connection;
    if (!identityStable) _legacyBrowserId = browserId;
    if (previous != null) {
      await previous.disconnect(
        const ExtensionUnavailableError(
          'Chrome extension connection was replaced',
        ),
        close: true,
      );
    }
    return connection;
  }

  Future<void> detach(BrowserConnection connection) async {
    if (!identical(_connections[connection.browserId], connection)) return;
    _connections.remove(connection.browserId);
    if (_legacyBrowserId == connection.browserId) _legacyBrowserId = null;
    await connection.disconnect(
      const ExtensionUnavailableError('Chrome extension disconnected'),
    );
  }

  BrowserConnection resolve([String? browserId]) {
    if (browserId != null) {
      final c = _connections[browserId];
      if (c == null) {
        throw ExtensionUnavailableError(
          "No connected Chrome browser has browser_id '$browserId'. "
          'Call browser_instances to list connected browsers.',
        );
      }
      return c;
    }
    if (_connections.isEmpty) {
      throw const ExtensionUnavailableError(
        'No Chrome extension is connected. Open the extension and check its settings.',
      );
    }
    if (_connections.length > 1) {
      throw const ExtensionUnavailableError(
        'Multiple Chrome browsers are connected. Call browser_instances and pass browser_id explicitly.',
      );
    }
    return _connections.values.single;
  }
}
