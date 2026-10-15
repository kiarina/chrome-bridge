import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'controller.dart';
import 'coordinator.dart';
import 'errors.dart';
import 'ids.dart';
import 'mcp.dart';
import 'protocol.dart';
import 'registry.dart';
import 'tools.dart';
import 'version.dart';

/// The server's settings (the Python server's `Settings`, without managed
/// mode: an embedding app owns the server's lifetime).
class ChromeBridgeSettings {
  const ChromeBridgeSettings({
    this.host = '127.0.0.1',
    this.port = 8765,
    this.commandTimeout = const Duration(seconds: 15),
    this.operationWait = const Duration(seconds: 30),
    this.sessionIdleTtl = const Duration(seconds: 120),
    this.sessionMaxLifetime = const Duration(seconds: 600),
  });

  /// From `CHROME_BRIDGE_HOST`, `CHROME_BRIDGE_PORT` and the timeouts'
  /// variables, as the Python server reads them.
  factory ChromeBridgeSettings.fromEnvironment([Map<String, String>? env]) {
    final e = env ?? Platform.environment;
    final host = e['CHROME_BRIDGE_HOST'] ?? '127.0.0.1';
    if (!const {'127.0.0.1', '::1', 'localhost'}.contains(host)) {
      throw ArgumentError('CHROME_BRIDGE_HOST must be a loopback host');
    }
    Duration seconds(String name, num fallback) => Duration(
      milliseconds: ((num.tryParse(e[name] ?? '') ?? fallback) * 1000).round(),
    );
    return ChromeBridgeSettings(
      host: host,
      port: int.tryParse(e['CHROME_BRIDGE_PORT'] ?? '') ?? 8765,
      commandTimeout: seconds('CHROME_BRIDGE_COMMAND_TIMEOUT', 15),
      operationWait: seconds('CHROME_BRIDGE_OPERATION_WAIT_TIMEOUT', 30),
      sessionIdleTtl: seconds('CHROME_BRIDGE_SESSION_IDLE_TTL', 120),
      sessionMaxLifetime: seconds('CHROME_BRIDGE_SESSION_MAX_LIFETIME', 600),
    );
  }

  final String host;
  final int port;
  final Duration commandTimeout;
  final Duration operationWait;
  final Duration sessionIdleTtl;
  final Duration sessionMaxLifetime;
}

/// The port is taken: the server did not start. [occupant] is what answers
/// `/api/v1/meta` there, when it is a Chrome Bridge server.
class PortInUseError implements Exception {
  PortInUseError(this.port, this.occupant);

  final int port;
  final Map<String, dynamic>? occupant;

  String get message {
    final o = occupant;
    if (o == null) {
      return 'Port $port is in use by another program, so Chrome Bridge cannot start there.';
    }
    final kind = switch (o['implementation']) {
      'dart' => 'Dart',
      'python' => 'Python',
      _ => null,
    };
    final who = [
      'Chrome Bridge server',
      if (kind != null) '($kind ${o['serverVersion']})',
    ].join(' ');
    return 'Port $port is used by $who. Stop it to let this app use Chrome '
        '(the extension connects to one server).';
  }

  @override
  String toString() => message;
}

/// A Chrome Bridge server in this process: the extension endpoint
/// (`/extension`), the Direct API (`/api/v1`), MCP (`/mcp`) and `/health`,
/// on loopback, and the same operations called directly ([call],
/// [session]). Start it with [start].
class ChromeBridgeServer {
  ChromeBridgeServer._(this.settings, this._http)
    : _registry = BrowserRegistry(timeout: settings.commandTimeout) {
    _controller = BrowserController(_registry);
    _coordinator = OperationCoordinator()..start();
    _mcp = McpEndpoint(
      _controller,
      _coordinator,
      operationWait: settings.operationWait,
    );
    _http.listen((request) => unawaited(_handle(request)));
  }

  /// Binds [settings]' port and serves. A taken port is a [PortInUseError]
  /// naming what holds it (nothing is started).
  static Future<ChromeBridgeServer> start([
    ChromeBridgeSettings settings = const ChromeBridgeSettings(),
  ]) async {
    final HttpServer http;
    try {
      http = await HttpServer.bind(settings.host, settings.port);
    } on SocketException {
      throw PortInUseError(
        settings.port,
        await _probeMeta(settings.host, settings.port),
      );
    }
    return ChromeBridgeServer._(settings, http);
  }

  static Future<Map<String, dynamic>?> _probeMeta(String host, int port) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 1);
    try {
      final request = await client.getUrl(
        Uri.parse('http://${host == '::1' ? '[::1]' : host}:$port/api/v1/meta'),
      );
      final response = await request.close().timeout(
        const Duration(seconds: 2),
      );
      final body = jsonDecode(await response.transform(utf8.decoder).join());
      return body is Map && body['service'] == 'chrome-bridge'
          ? body.cast<String, dynamic>()
          : null;
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  final ChromeBridgeSettings settings;
  final HttpServer _http;
  final BrowserRegistry _registry;
  late final BrowserController _controller;
  late final OperationCoordinator _coordinator;
  late final McpEndpoint _mcp;
  final String _instanceId = uuid4();
  final _sockets = <WebSocket>{};

  /// The port it listens on (the settings' or, for port 0, the one given).
  int get port => _http.port;
  Uri get httpUrl => Uri.parse('http://127.0.0.1:$port');

  bool get extensionConnected => _registry.connected;
  int get connectedBrowserCount => _registry.connectedCount;

  /// The connected browsers (`browser_instances`).
  List<Map<String, dynamic>> instances() => _registry.instances();

  /// Calls the Direct API method [method] (`browser_snapshot`,
  /// `browser_click`...) as one operation in the shared FIFO: its result, or
  /// a [ChromeBridgeException].
  Future<Object?> call(String method, Map<String, dynamic> arguments) =>
      _coordinator.singleCall(
        () => callDirect(_controller, method, arguments),
        timeout: settings.operationWait,
      );

  /// Takes the exclusive session: other clients of this server wait until it
  /// is released (or idle past [idleTtl] without a call, or past
  /// [maxLifetime]). It keeps itself alive while held.
  Future<ChromeBridgeSession> session({
    Duration? idleTtl,
    Duration? maxLifetime,
    Duration? wait,
  }) async {
    final lease = await _coordinator.acquireSession(
      idleTtl: idleTtl ?? settings.sessionIdleTtl,
      maxLifetime: maxLifetime ?? settings.sessionMaxLifetime,
      timeout: wait,
    );
    return ChromeBridgeSession._(this, lease);
  }

  Future<void> close() async {
    _coordinator.close();
    for (final s in _sockets.toList()) {
      await s.close(1001, 'Server stopped');
    }
    await _http.close(force: true);
  }

  Map<String, Object?> _meta() => {
    'service': 'chrome-bridge',
    'apiVersion': apiVersion,
    'serverVersion': serverVersion,
    'implementation': 'dart',
    'instanceId': _instanceId,
    'mode': 'persistent',
    'extensionConnected': _registry.connected,
    'connectedBrowserCount': _registry.connectedCount,
  };

  // ---- HTTP -----------------------------------------------------------------

  static bool _hostIsLoopback(String? host) {
    if (host == null) return false;
    final h = host.startsWith('[')
        ? host.substring(1, host.indexOf(']'))
        : host.split(':').first;
    return const {'127.0.0.1', 'localhost', '::1'}.contains(h.toLowerCase());
  }

  // The extension only opens the bridge WebSocket and probes health. Other
  // extensions must not reach /mcp or /api/v1 just by being installed in the
  // same browser.
  static bool _originIsAllowed(String? origin, String path) {
    if (origin == null) return true;
    final uri = Uri.tryParse(origin);
    if (uri == null) return false;
    if (uri.scheme == 'chrome-extension') {
      return uri.host.isNotEmpty && (path == '/extension' || path == '/health');
    }
    return uri.scheme == 'http' &&
        const {'127.0.0.1', 'localhost', '::1'}.contains(uri.host);
  }

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    try {
      // The single Host/Origin check for every route (DNS rebinding).
      if (!_hostIsLoopback(request.headers.value(HttpHeaders.hostHeader)) ||
          !_originIsAllowed(request.headers.value('origin'), path)) {
        return await _json(request.response, 403, {
          'detail': 'Forbidden origin',
        });
      }
      final method = request.method;
      if (path == '/extension') {
        if (!WebSocketTransformer.isUpgradeRequest(request)) {
          return await _json(request.response, 400, {
            'detail': 'WebSocket upgrade required',
          });
        }
        return await _extension(await WebSocketTransformer.upgrade(request));
      }
      if (path == '/health') {
        if (method != 'GET') return await _methodNotAllowed(request);
        return await _json(request.response, 200, {
          'status': 'ok',
          'extensionConnected': _registry.connected,
          'connectedBrowserCount': _registry.connectedCount,
          'extension': _registry.extensionInfo,
        });
      }
      if (path == '/mcp') {
        if (method != 'POST') {
          return await _json(request.response, 405, {
            'jsonrpc': '2.0',
            'id': null,
            'error': {
              'code': -32600,
              'message': 'Method Not Allowed: only stateless POST is supported',
            },
          });
        }
        final (status, body) = await _mcp.handle(
          await utf8.decoder.bind(request).join(),
        );
        return await _json(request.response, status, body);
      }
      if (path.startsWith('/api/v1/')) {
        return await _api(request, path.substring('/api/v1'.length));
      }
      return await _text(request.response, 404, 'Not Found');
    } catch (e) {
      try {
        await _json(request.response, 500, {'detail': 'Internal Server Error'});
      } catch (_) {}
    }
  }

  static Future<void> _methodNotAllowed(HttpRequest request) =>
      _json(request.response, 405, {'detail': 'Method Not Allowed'});

  static Future<void> _text(
    HttpResponse response,
    int status,
    String body,
  ) async {
    response.statusCode = status;
    response.headers.contentType = ContentType.text;
    response.write(body);
    await response.close();
  }

  static Future<void> _json(
    HttpResponse response,
    int status,
    Object? body,
  ) async {
    response.statusCode = status;
    response.headers.contentType = ContentType.json;
    if (body != null) response.write(jsonEncode(body));
    await response.close();
  }

  Future<void> _api(HttpRequest request, String route) async {
    final method = request.method;
    final segments = route.split('/').where((s) => s.isNotEmpty).toList();
    if (route == '/meta') {
      return method == 'GET'
          ? _json(request.response, 200, _meta())
          : _methodNotAllowed(request);
    }
    if (route == '/tools') {
      return method == 'GET'
          ? _json(request.response, 200, {'tools': directToolDefinitions})
          : _methodNotAllowed(request);
    }
    if (route == '/sessions') {
      if (method != 'POST') return _methodNotAllowed(request);
      return _apiResult(request, () async {
        final body = await _requestObject(request);
        final idle = _numberOption(
          body,
          'idleTtlSeconds',
          settings.sessionIdleTtl,
          30,
          300,
        );
        final maximum = _numberOption(
          body,
          'maxLifetimeSeconds',
          settings.sessionMaxLifetime,
          60,
          3600,
        );
        Duration? wait;
        if (body['waitTimeoutSeconds'] != null) {
          wait = _finiteSeconds(
            body['waitTimeoutSeconds'],
            'waitTimeoutSeconds',
            0,
            600,
          );
        }
        final lease = await _coordinator.acquireSession(
          idleTtl: idle,
          maxLifetime: maximum,
          timeout: wait,
        );
        return lease.asJson();
      });
    }
    if (segments.length == 3 &&
        segments[0] == 'sessions' &&
        segments[2] == 'heartbeat') {
      if (method != 'POST') return _methodNotAllowed(request);
      return _apiResult(request, () async {
        final lease = _coordinator.heartbeat(
          segments[1],
          _sessionToken(request),
        );
        return {
          'sessionId': lease.sessionId,
          'idleTtlSeconds': lease.asJson()['idleTtlSeconds'],
        };
      });
    }
    if (segments.length == 2 && segments[0] == 'sessions') {
      if (method != 'DELETE') return _methodNotAllowed(request);
      return _apiResult(
        request,
        () async => {
          'released': _coordinator.releaseSession(
            segments[1],
            _sessionToken(request),
          ),
        },
      );
    }
    if (route == '/call') {
      if (method != 'POST') return _methodNotAllowed(request);
      var entered = false;
      return _apiResult(
        request,
        () async {
          final body = await _requestObject(request);
          if (body.length != 2 ||
              !body.containsKey('method') ||
              !body.containsKey('arguments')) {
            throw const InvalidArgumentError(
              'body must contain method and arguments',
            );
          }
          final name = body['method'];
          final arguments = body['arguments'];
          if (name is! String || arguments is! Map) {
            throw const InvalidArgumentError(
              'method must be a string and arguments must be an object',
            );
          }
          final sessionId = request.headers.value('x-chrome-bridge-session');
          final authorization = request.headers.value(
            HttpHeaders.authorizationHeader,
          );
          Future<Object?> run() {
            entered = true;
            return callDirect(
              _controller,
              name,
              arguments.cast<String, dynamic>(),
            );
          }

          if (sessionId == null && authorization == null) {
            return _coordinator.singleCall(
              run,
              timeout: settings.operationWait,
            );
          }
          if (sessionId != null && authorization != null) {
            return _coordinator.sessionCall(
              sessionId,
              _sessionToken(request),
              run,
            );
          }
          throw const SessionAuthenticationError(
            'Session ID and bearer token must be provided together',
          );
        },
        outcomeUnknown: (e) =>
            entered &&
            (e is ExtensionUnavailableError ||
                '$e'.startsWith('Operation outcome unknown:')),
      );
    }
    return _text(request.response, 404, 'Not Found');
  }

  Future<void> _apiResult(
    HttpRequest request,
    Future<Object?> Function() body, {
    bool Function(Object error)? outcomeUnknown,
  }) async {
    try {
      final result = await body();
      return await _json(request.response, 200, {'ok': true, 'result': result});
    } catch (e) {
      final unknown = outcomeUnknown?.call(e) ?? false;
      var (status, code, retryable) = switch (e) {
        MethodNotFoundError() => (404, 'method_not_found', false),
        InvalidArgumentError() => (400, 'invalid_argument', false),
        SessionAuthenticationError() => (401, 'invalid_session_token', false),
        SessionNotFoundError() => (409, 'session_expired', false),
        CoordinatorBusyError() => (409, 'busy', true),
        ExtensionUnavailableError() => (503, 'extension_unavailable', true),
        ExtensionCommandError() => (502, 'extension_command_failed', false),
        _ => (500, 'internal_error', false),
      };
      return _json(request.response, status, {
        'ok': false,
        'error': {
          'code': code,
          'message': e is ChromeBridgeException
              ? e.message
              : e.runtimeType.toString(),
          'retryable': retryable && !unknown,
          'outcomeUnknown': unknown,
        },
      });
    }
  }

  static Future<Map<String, dynamic>> _requestObject(
    HttpRequest request,
  ) async {
    final Object? body;
    try {
      body = jsonDecode(await utf8.decoder.bind(request).join());
    } on FormatException {
      throw const InvalidArgumentError('request body must be valid JSON');
    }
    if (body is! Map) {
      throw const InvalidArgumentError('request body must be a JSON object');
    }
    return body.cast<String, dynamic>();
  }

  static String _sessionToken(HttpRequest request) {
    final value = request.headers.value(HttpHeaders.authorizationHeader) ?? '';
    final space = value.indexOf(' ');
    if (space <= 0 ||
        value.substring(0, space).toLowerCase() != 'bearer' ||
        space == value.length - 1) {
      throw const SessionAuthenticationError(
        'A bearer session token is required',
      );
    }
    return value.substring(space + 1);
  }

  static Duration _numberOption(
    Map<String, dynamic> body,
    String name,
    Duration fallback,
    num min,
    num max,
  ) => body.containsKey(name)
      ? _finiteSeconds(body[name], name, min, max)
      : _finiteSeconds(fallback.inMicroseconds / 1e6, name, min, max);

  static Duration _finiteSeconds(Object? value, String name, num min, num max) {
    if (value is! num || !value.isFinite || value < min || value > max) {
      throw InvalidArgumentError(
        '$name must be between ${formatG(min)} and ${formatG(max)} seconds',
      );
    }
    return Duration(microseconds: (value * 1e6).round());
  }

  // ---- extension WebSocket ---------------------------------------------------

  Future<void> _extension(WebSocket socket) async {
    _sockets.add(socket);
    final adapter = _SocketAdapter(socket);
    BrowserConnection? connection;
    try {
      await for (final data in socket) {
        final Object? message;
        try {
          message = jsonDecode(data as String);
        } catch (_) {
          await socket.close(1002, 'Malformed extension JSON');
          return;
        }
        try {
          if (connection == null) {
            validateExtensionInitialMessage(message);
            connection = await _registry.attach(
              adapter,
              (message as Map).cast<String, dynamic>(),
            );
            continue;
          }
          validateExtensionRuntimeMessage(message);
          final reply = connection.receive(
            (message as Map).cast<String, dynamic>(),
          );
          if (reply != null) {
            validateServerMessage(reply);
            adapter.sendJson(reply);
          }
        } on ProtocolValidationError catch (e) {
          final reason = e.message.length > 123
              ? e.message.substring(0, 123)
              : e.message;
          await socket.close(1002, reason);
          return;
        }
      }
    } finally {
      _sockets.remove(socket);
      if (connection != null) await _registry.detach(connection);
    }
  }
}

class _SocketAdapter implements ExtensionSocket {
  _SocketAdapter(this._socket);

  final WebSocket _socket;

  @override
  void sendJson(Object message) => _socket.add(jsonEncode(message));

  @override
  Future<void> close(int code, String reason) => _socket.close(code, reason);
}

/// The exclusive session of [ChromeBridgeServer.session]: its calls run one
/// at a time while every other client waits. Release it when done.
class ChromeBridgeSession {
  ChromeBridgeSession._(this._server, this._lease) {
    final every = _lease.idleTtl ~/ 3;
    _heartbeat = Timer.periodic(
      every < const Duration(seconds: 1) ? const Duration(seconds: 1) : every,
      (_) {
        try {
          _server._coordinator.heartbeat(_lease.sessionId, _lease.token);
        } catch (_) {
          _heartbeat?.cancel();
        }
      },
    );
  }

  final ChromeBridgeServer _server;
  final SessionLease _lease;
  Timer? _heartbeat;

  Future<Object?> call(String method, Map<String, dynamic> arguments) =>
      _server._coordinator.sessionCall(
        _lease.sessionId,
        _lease.token,
        () => callDirect(_server._controller, method, arguments),
      );

  /// Lets other clients use Chrome again.
  void release() {
    _heartbeat?.cancel();
    _server._coordinator.releaseSession(_lease.sessionId, _lease.token);
  }
}
