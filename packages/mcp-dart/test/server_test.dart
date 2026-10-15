import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:chrome_bridge_mcp/chrome_bridge_mcp.dart';
import 'package:test/test.dart';

const browserId = '8b1f0c52-6f0e-4b5a-9a7e-2f1c3d4e5a6b';
const snapshot = {
  'generation': 3,
  'url': 'https://example.test/',
  'title': 'Example',
  'snapshot': '- button "Save" [ref=s3e1]',
};

/// A fake extension: says hello, then answers every command with [answer].
Future<WebSocket> connectExtension(
  ChromeBridgeServer server, {
  Object? Function(String type, Map params)? answer,
  Map<String, Object?>? hello,
}) async {
  final socket = await WebSocket.connect(
    'ws://127.0.0.1:${server.port}/extension',
    headers: {'origin': 'chrome-extension://abcdefghijklmnop'},
  );
  socket.add(
    jsonEncode(
      hello ??
          {
            'type': 'hello',
            'protocolVersion': 2,
            'extensionVersion': '0.5.0',
            'browserId': browserId,
            'browserLabel': 'Work',
          },
    ),
  );
  socket.listen((data) {
    final m = jsonDecode(data as String) as Map;
    if (m['id'] == null) return;
    final result =
        (answer ?? (type, _) => type == 'page.snapshot' ? snapshot : null)(
          m['type'] as String,
          m['params'] as Map,
        );
    socket.add(jsonEncode({'id': m['id'], 'ok': true, 'result': result}));
  });
  for (var i = 0; i < 50 && !server.extensionConnected; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  return socket;
}

Future<(int, Object?)> post(
  ChromeBridgeServer server,
  String path,
  Object body, {
  Map<String, String>? headers,
}) async {
  final client = HttpClient();
  try {
    final request = await client.postUrl(server.httpUrl.resolve(path));
    request.headers.contentType = ContentType.json;
    headers?.forEach(request.headers.set);
    request.write(jsonEncode(body));
    final response = await request.close();
    final text = await response.transform(utf8.decoder).join();
    return (response.statusCode, text.isEmpty ? null : jsonDecode(text));
  } finally {
    client.close();
  }
}

void main() {
  late ChromeBridgeServer server;

  setUp(() async {
    server = await ChromeBridgeServer.start(
      const ChromeBridgeSettings(
        port: 0,
        operationWait: Duration(milliseconds: 300),
      ),
    );
  });
  tearDown(() => server.close());

  test('called in process: the operation, with the browser ID added', () async {
    final socket = await connectExtension(server);
    expect(server.instances().single['browserId'], browserId);
    expect(await server.call('browser_snapshot', {}), {
      ...snapshot,
      'browserId': browserId,
    });
    await expectLater(
      server.call('browser_tab_open', {'url': 'file:///etc/passwd'}),
      throwsA(isA<InvalidArgumentError>()),
    );
    await expectLater(
      server.call('browser_nope', {}),
      throwsA(isA<MethodNotFoundError>()),
    );
    await socket.close();
  });

  test('without an extension, a clear unavailable error', () async {
    await expectLater(
      server.call('browser_snapshot', {}),
      throwsA(
        isA<ExtensionUnavailableError>().having(
          (e) => e.message,
          'message',
          contains('No Chrome extension'),
        ),
      ),
    );
  });

  test(
    'an exclusive session holds Chrome: other clients get busy until it is released',
    () async {
      final socket = await connectExtension(server);
      final session = await server.session();
      expect(
        await session.call('browser_snapshot', {}),
        containsPair('browserId', browserId),
      );
      final (status, body) = await post(server, '/api/v1/call', {
        'method': 'browser_snapshot',
        'arguments': {},
      });
      expect(status, 409);
      expect((body as Map)['error']['code'], 'busy');
      await expectLater(
        server.call('browser_snapshot', {}),
        throwsA(isA<CoordinatorBusyError>()),
      );
      session.release();
      expect(
        await server.call('browser_snapshot', {}),
        containsPair('generation', 3),
      );
      await socket.close();
    },
  );

  test(
    'a taken port names the server that holds it, and nothing starts',
    () async {
      await expectLater(
        ChromeBridgeServer.start(ChromeBridgeSettings(port: server.port)),
        throwsA(
          isA<PortInUseError>()
              .having(
                (e) => e.occupant?['implementation'],
                'implementation',
                'dart',
              )
              .having(
                (e) => e.message,
                'message',
                contains('Chrome Bridge server (Dart'),
              ),
        ),
      );
    },
  );

  test(
    'MCP lists the same tools and calls them through the shared FIFO',
    () async {
      final socket = await connectExtension(server);
      final (_, list) = await post(server, '/mcp', {
        'jsonrpc': '2.0',
        'id': 1,
        'method': 'tools/list',
      });
      expect(((list as Map)['result']['tools'] as List).length, 24);
      final (_, call) = await post(server, '/mcp', {
        'jsonrpc': '2.0',
        'id': 2,
        'method': 'tools/call',
        'params': {'name': 'browser_snapshot', 'arguments': {}},
      });
      final result = (call as Map)['result'] as Map;
      expect(result['isError'], false);
      expect(result['structuredContent'], {
        ...snapshot,
        'browserId': browserId,
      });
      await socket.close();
    },
  );

  test(
    'a late answer to a timed-out command is ignored; the extension stays connected',
    () async {
      final quick = await ChromeBridgeServer.start(
        const ChromeBridgeSettings(
          port: 0,
          commandTimeout: Duration(milliseconds: 200),
        ),
      );
      addTearDown(quick.close);
      final socket = await WebSocket.connect(
        'ws://127.0.0.1:${quick.port}/extension',
        headers: {'origin': 'chrome-extension://abcdefghijklmnop'},
      );
      socket.add(
        jsonEncode({
          'type': 'hello',
          'protocolVersion': 2,
          'extensionVersion': '0.5.0',
          'browserId': browserId,
          'browserLabel': 'Work',
        }),
      );
      var first = true;
      socket.listen((data) async {
        final m = jsonDecode(data as String) as Map;
        if (m['id'] == null) return;
        if (first) {
          first = false;
          await Future<void>.delayed(
            const Duration(milliseconds: 400),
          ); // too late
        }
        socket.add(jsonEncode({'id': m['id'], 'ok': true, 'result': snapshot}));
      });
      for (var i = 0; i < 50 && !quick.extensionConnected; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
      await expectLater(
        quick.call('browser_snapshot', {}),
        throwsA(
          isA<ExtensionCommandError>().having(
            (e) => e.message,
            'message',
            contains('timed out'),
          ),
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(quick.extensionConnected, true);
      expect(
        await quick.call('browser_snapshot', {}),
        containsPair('generation', 3),
      );
      await socket.close();
    },
  );

  test(
    'a hello that breaks the protocol closes the socket with 1002',
    () async {
      final socket = await WebSocket.connect(
        'ws://127.0.0.1:${server.port}/extension',
        headers: {'origin': 'chrome-extension://abcdefghijklmnop'},
      );
      socket.add(jsonEncode({'type': 'hello', 'protocolVersion': 3}));
      await socket.drain<void>();
      expect(socket.closeCode, 1002);
      expect(socket.closeReason, startsWith('Invalid extension hello'));
      expect(server.extensionConnected, false);
    },
  );

  test('foreign origins and hosts are refused', () async {
    final client = HttpClient();
    try {
      for (final (header, value) in [
        ('origin', 'https://evil.example'),
        ('host', 'evil.example'),
      ]) {
        final request = await client.getUrl(server.httpUrl.resolve('/health'));
        request.headers.set(header, value);
        final response = await request.close();
        await response.drain<void>();
        expect(response.statusCode, 403, reason: header);
      }
    } finally {
      client.close();
    }
  });
}
