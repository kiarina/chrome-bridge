import 'dart:async';
import 'dart:collection';

import 'errors.dart';
import 'ids.dart';

/// An exclusive session: holds every browser operation until released, idle
/// past its TTL, or past its lifetime.
class SessionLease {
  SessionLease({
    required this.sessionId,
    required this.token,
    required this.createdAt,
    required this.idleTtl,
    required this.maxLifetime,
  }) : lastHeartbeat = createdAt;

  final String sessionId;
  final String token;
  final DateTime createdAt;
  final Duration idleTtl;
  final Duration maxLifetime;
  DateTime lastHeartbeat;
  int inFlight = 0;
  bool releasePending = false;
  Future<void> _callTail = Future.value();

  DateTime get idleDeadline => lastHeartbeat.add(idleTtl);
  DateTime get maximumDeadline => createdAt.add(maxLifetime);
  DateTime get deadline =>
      idleDeadline.isBefore(maximumDeadline) ? idleDeadline : maximumDeadline;

  Map<String, Object> asJson() => {
    'sessionId': sessionId,
    'token': token,
    'idleTtlSeconds': _seconds(idleTtl),
    'maxLifetimeSeconds': _seconds(maxLifetime),
  };

  /// Runs [body] after the session's earlier calls (one at a time).
  Future<T> _serialized<T>(Future<T> Function() body) {
    final previous = _callTail;
    final done = Completer<void>();
    _callTail = done.future;
    return previous.then((_) => body()).whenComplete(done.complete);
  }
}

double _seconds(Duration d) =>
    d.inMicroseconds / Duration.microsecondsPerSecond;

class _Waiter {
  _Waiter.single()
    : kind = 'single',
      idleTtl = Duration.zero,
      maxLifetime = Duration.zero;
  _Waiter.session(this.idleTtl, this.maxLifetime) : kind = 'session';

  final String kind;
  final Duration idleTtl;
  final Duration maxLifetime;
  final completer = Completer<SessionLease?>();
  bool granted = false;
  SessionLease? grantedLease;
}

/// A fair, process-wide lease for all browser operations (the Python
/// server's `OperationCoordinator`): one operation at a time in FIFO order,
/// or every operation of one exclusive session.
class OperationCoordinator {
  OperationCoordinator({
    DateTime Function()? clock,
    void Function()? onActivity,
  }) : _clock = clock ?? DateTime.now,
       _onActivity = onActivity;

  final DateTime Function() _clock;
  final void Function()? _onActivity;
  final _waiters = Queue<_Waiter>();
  SessionLease? _activeSession;
  bool _singleActive = false;
  bool _closed = false;
  Timer? _reaper;

  bool get busy => _activeSession != null || _singleActive;
  int get waiterCount => _waiters.length;

  void start() =>
      _reaper ??= Timer.periodic(const Duration(seconds: 1), (_) => _reap());

  void close() {
    _closed = true;
    _reaper?.cancel();
    _reaper = null;
    for (final w in _waiters) {
      if (!w.completer.isCompleted) {
        w.completer.completeError(StateError('Coordinator closed'));
      }
    }
    _waiters.clear();
  }

  Future<SessionLease> acquireSession({
    required Duration idleTtl,
    required Duration maxLifetime,
    Duration? timeout,
  }) async {
    if (idleTtl <= Duration.zero || maxLifetime <= Duration.zero) {
      throw const InvalidArgumentError('session durations must be positive');
    }
    if (idleTtl > maxLifetime) {
      throw const InvalidArgumentError(
        'idle TTL cannot exceed maximum session lifetime',
      );
    }
    final waiter = _Waiter.session(idleTtl, maxLifetime);
    _enqueue(waiter);
    try {
      final lease = timeout == null
          ? await waiter.completer.future
          : await waiter.completer.future.timeout(timeout);
      return lease!;
    } on TimeoutException {
      _cancelWaiter(waiter);
      throw const CoordinatorBusyError(
        'Timed out waiting for an exclusive Chrome Bridge session',
      );
    }
  }

  SessionLease heartbeat(String sessionId, String token) {
    final lease = _requireSession(sessionId, token);
    final now = _clock();
    if (!now.isBefore(lease.maximumDeadline)) {
      _expireSession(lease);
      throw const SessionNotFoundError('Exclusive session expired');
    }
    lease.lastHeartbeat = now;
    return lease;
  }

  bool releaseSession(String sessionId, String token) {
    final lease = _activeSession;
    if (lease == null || lease.sessionId != sessionId) return false;
    if (!constantTimeEquals(lease.token, token)) {
      throw const SessionAuthenticationError('Invalid exclusive session token');
    }
    if (lease.inFlight > 0) {
      lease.releasePending = true;
    } else {
      _activeSession = null;
      _grantNext();
    }
    return true;
  }

  /// Runs [body] as a call of the exclusive session [sessionId].
  Future<T> sessionCall<T>(
    String sessionId,
    String token,
    Future<T> Function() body,
  ) {
    final lease = _requireSession(sessionId, token);
    return lease._serialized(() async {
      final current = _requireSession(sessionId, token);
      if (!_clock().isBefore(current.deadline)) {
        _expireSession(current);
        throw const SessionNotFoundError('Exclusive session expired');
      }
      current.inFlight++;
      _onActivity?.call();
      try {
        return await body();
      } finally {
        current.inFlight--;
        if (current.releasePending || !_clock().isBefore(current.deadline)) {
          _expireSession(current);
        }
      }
    });
  }

  /// Runs [body] as one operation in the FIFO, waiting at most [timeout] for
  /// its turn.
  Future<T> singleCall<T>(
    Future<T> Function() body, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final waiter = _Waiter.single();
    _enqueue(waiter);
    try {
      await waiter.completer.future.timeout(timeout);
    } on TimeoutException {
      _cancelWaiter(waiter);
      throw const CoordinatorBusyError(
        'Chrome Bridge is held by an exclusive session',
      );
    }
    try {
      return await body();
    } finally {
      _singleActive = false;
      _grantNext();
    }
  }

  void _enqueue(_Waiter waiter) {
    if (_closed) throw StateError('Coordinator closed');
    _waiters.add(waiter);
    _grantNext();
  }

  void _cancelWaiter(_Waiter waiter) {
    if (!_waiters.remove(waiter)) {
      if (waiter.kind == 'single' && waiter.granted && _singleActive) {
        _singleActive = false;
      } else if (waiter.kind == 'session' &&
          waiter.granted &&
          identical(_activeSession, waiter.grantedLease)) {
        _expireSession(waiter.grantedLease!);
      }
    }
    _grantNext();
  }

  void _grantNext() {
    if (busy) return;
    while (_waiters.isNotEmpty) {
      final waiter = _waiters.removeFirst();
      if (waiter.completer.isCompleted) continue;
      if (waiter.kind == 'single') {
        _singleActive = true;
        waiter.granted = true;
        _onActivity?.call();
        waiter.completer.complete(null);
        return;
      }
      final lease = SessionLease(
        sessionId: uuid4(),
        token: urlSafeToken(),
        createdAt: _clock(),
        idleTtl: waiter.idleTtl,
        maxLifetime: waiter.maxLifetime,
      );
      _activeSession = lease;
      waiter.granted = true;
      waiter.grantedLease = lease;
      _onActivity?.call();
      waiter.completer.complete(lease);
      return;
    }
  }

  SessionLease _requireSession(String sessionId, String token) {
    final lease = _activeSession;
    if (lease == null || lease.sessionId != sessionId) {
      throw const SessionNotFoundError(
        'Exclusive session is unknown or expired',
      );
    }
    if (!constantTimeEquals(lease.token, token)) {
      throw const SessionAuthenticationError('Invalid exclusive session token');
    }
    return lease;
  }

  void _expireSession(SessionLease lease) {
    if (!identical(_activeSession, lease)) return;
    if (lease.inFlight > 0) {
      lease.releasePending = true;
      return;
    }
    _activeSession = null;
    _grantNext();
  }

  void _reap() {
    final lease = _activeSession;
    if (lease != null && !_clock().isBefore(lease.deadline)) {
      _expireSession(lease);
    }
  }
}
