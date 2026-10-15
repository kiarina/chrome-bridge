/// Errors of the public contract (`docs/concepts/api.md` "Errors"). Each maps
/// to one Direct API error code and keeps its message for MCP tool errors.
sealed class ChromeBridgeException implements Exception {
  const ChromeBridgeException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// No extension is connected, or the browser asked for is not (503,
/// `extension_unavailable`, retryable).
final class ExtensionUnavailableError extends ChromeBridgeException {
  const ExtensionUnavailableError(super.message);
}

/// The extension rejected a command, timed out, or answered something invalid
/// (502, `extension_command_failed`).
final class ExtensionCommandError extends ChromeBridgeException {
  const ExtensionCommandError(super.message);
}

/// An argument is invalid (400, `invalid_argument`).
final class InvalidArgumentError extends ChromeBridgeException {
  const InvalidArgumentError(super.message);
}

/// An operation could not get the shared lease in time (409, `busy`,
/// retryable).
final class CoordinatorBusyError extends ChromeBridgeException {
  const CoordinatorBusyError(super.message);
}

/// The exclusive session is unknown, expired, or released (409,
/// `session_expired`).
final class SessionNotFoundError extends ChromeBridgeException {
  const SessionNotFoundError(super.message);
}

/// A session token does not match its lease (401, `invalid_session_token`).
final class SessionAuthenticationError extends ChromeBridgeException {
  const SessionAuthenticationError(super.message);
}

/// No such Direct API method (404, `method_not_found`).
final class MethodNotFoundError extends ChromeBridgeException {
  const MethodNotFoundError(super.message);
}

/// An extension message does not match the protocol schema; the connection
/// is closed (WebSocket 1002).
final class ProtocolValidationError extends ChromeBridgeException {
  const ProtocolValidationError(super.message);
}
