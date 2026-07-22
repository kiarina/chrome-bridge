class ChromeBridgeError(RuntimeError):
    """Base SDK exception."""


class NestedSessionError(ChromeBridgeError):
    pass


class ServerUnavailableError(ChromeBridgeError):
    pass


class IncompatibleServerError(ChromeBridgeError):
    pass


class ExtensionUnavailableError(ChromeBridgeError):
    pass


class SessionAcquireTimeoutError(ChromeBridgeError):
    pass


class SessionExpiredError(ChromeBridgeError):
    pass


class OperationError(ChromeBridgeError):
    pass


class OperationOutcomeUnknownError(OperationError):
    pass
