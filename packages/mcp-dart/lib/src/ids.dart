import 'dart:convert';
import 'dart:math';

final _random = Random.secure();

/// A random UUID version 4, lower case (as Python's `uuid4`).
String uuid4() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = [for (final x in b) x.toRadixString(16).padLeft(2, '0')].join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

/// A URL-safe random token of [bytes] bytes, without padding (as Python's
/// `secrets.token_urlsafe`).
String urlSafeToken([int bytes = 32]) => base64Url
    .encode(List<int>.generate(bytes, (_) => _random.nextInt(256)))
    .replaceAll('=', '');

/// Compares two strings in time independent of where they differ.
bool constantTimeEquals(String a, String b) {
  final x = utf8.encode(a), y = utf8.encode(b);
  var diff = x.length ^ y.length;
  for (var i = 0; i < x.length && i < y.length; i++) {
    diff |= x[i] ^ y[i];
  }
  return diff == 0;
}
