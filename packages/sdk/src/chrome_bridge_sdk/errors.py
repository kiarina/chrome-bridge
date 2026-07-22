class ChromeBridgeError(RuntimeError):
    """Base SDK exception."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "chrome_bridge_error",
        retryable: bool = False,
        outcome_unknown: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.outcome_unknown = outcome_unknown


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
    def __init__(
        self,
        message: str,
        *,
        code: str = "operation_outcome_unknown",
        retryable: bool = False,
        outcome_unknown: bool = True,
    ) -> None:
        super().__init__(
            message,
            code=code,
            retryable=retryable,
            outcome_unknown=outcome_unknown,
        )
