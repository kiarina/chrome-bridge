import 'dart:async';

import 'package:chrome_bridge_mcp/chrome_bridge_mcp.dart';
import 'package:chrome_bridge_mcp/src/coordinator.dart';
import 'package:test/test.dart';

void main() {
  test('one operation at a time, in arrival order', () async {
    final c = OperationCoordinator();
    final order = <int>[];
    final gate = Completer<void>();
    final first = c.singleCall(() async {
      await gate.future;
      order.add(1);
    });
    final second = c.singleCall(() async => order.add(2));
    final third = c.singleCall(() async => order.add(3));
    await Future<void>.delayed(Duration.zero);
    expect(order, isEmpty);
    gate.complete();
    await Future.wait([first, second, third]);
    expect(order, [1, 2, 3]);
  });

  test(
    'a session that is not kept alive expires, and the next waiter gets its turn',
    () async {
      var now = DateTime(2026);
      final c = OperationCoordinator(clock: () => now);
      final lease = await c.acquireSession(
        idleTtl: const Duration(seconds: 30),
        maxLifetime: const Duration(seconds: 60),
      );
      final waiting = c.singleCall(
        () async => 'ran',
        timeout: const Duration(seconds: 5),
      );
      now = now.add(const Duration(seconds: 31));
      expect(
        () => c.heartbeat(lease.sessionId, 'wrong'),
        throwsA(isA<SessionAuthenticationError>()),
      );
      await expectLater(
        c.sessionCall(lease.sessionId, lease.token, () async => 'late'),
        throwsA(isA<SessionNotFoundError>()),
      );
      expect(await waiting, 'ran');
    },
  );

  test('releasing during a call waits for the call to end', () async {
    final c = OperationCoordinator();
    final lease = await c.acquireSession(
      idleTtl: const Duration(seconds: 30),
      maxLifetime: const Duration(seconds: 60),
    );
    final gate = Completer<void>();
    final call = c.sessionCall(lease.sessionId, lease.token, () => gate.future);
    await Future<void>.delayed(Duration.zero);
    expect(c.releaseSession(lease.sessionId, lease.token), true);
    expect(c.busy, true);
    gate.complete();
    await call;
    expect(c.busy, false);
  });
}
