from __future__ import annotations

import asyncio
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable
from uuid import uuid4


class CoordinatorBusyError(RuntimeError):
    """Raised when an operation cannot acquire the shared browser lease in time."""


class SessionNotFoundError(RuntimeError):
    """Raised when an exclusive session is unknown, expired, or already released."""


class SessionAuthenticationError(RuntimeError):
    """Raised when a session token does not match its lease."""


@dataclass(slots=True)
class SessionLease:
    session_id: str
    token: str
    created_at: float
    idle_ttl_seconds: float
    max_lifetime_seconds: float
    last_heartbeat: float
    call_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    in_flight: int = 0
    release_pending: bool = False

    @property
    def idle_deadline(self) -> float:
        return self.last_heartbeat + self.idle_ttl_seconds

    @property
    def maximum_deadline(self) -> float:
        return self.created_at + self.max_lifetime_seconds

    def as_dict(self) -> dict[str, object]:
        return {
            "sessionId": self.session_id,
            "token": self.token,
            "idleTtlSeconds": self.idle_ttl_seconds,
            "maxLifetimeSeconds": self.max_lifetime_seconds,
        }


@dataclass(slots=True)
class _Waiter:
    kind: str
    future: asyncio.Future[SessionLease | None]
    idle_ttl_seconds: float = 0
    max_lifetime_seconds: float = 0
    granted: bool = False
    granted_lease: SessionLease | None = None


class OperationCoordinator:
    """A fair, process-wide lease for all browser operations."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        on_activity: Callable[[], None] | None = None,
    ) -> None:
        self._clock = clock
        self._on_activity = on_activity
        self._guard = asyncio.Lock()
        self._waiters: deque[_Waiter] = deque()
        self._active_session: SessionLease | None = None
        self._single_active = False
        self._closed = False
        self._reaper: asyncio.Task[None] | None = None

    @property
    def busy(self) -> bool:
        return self._active_session is not None or self._single_active

    @property
    def waiter_count(self) -> int:
        return len(self._waiters)

    def start(self) -> None:
        if self._reaper is None:
            self._reaper = asyncio.create_task(self._reap_loop())

    async def close(self) -> None:
        self._closed = True
        if self._reaper is not None:
            self._reaper.cancel()
            await asyncio.gather(self._reaper, return_exceptions=True)
            self._reaper = None
        async with self._guard:
            for waiter in self._waiters:
                if not waiter.future.done():
                    waiter.future.set_exception(RuntimeError("Coordinator closed"))
            self._waiters.clear()

    async def acquire_session(
        self,
        *,
        idle_ttl_seconds: float,
        max_lifetime_seconds: float,
        timeout_seconds: float | None,
    ) -> SessionLease:
        if idle_ttl_seconds <= 0 or max_lifetime_seconds <= 0:
            raise ValueError("session durations must be positive")
        if idle_ttl_seconds > max_lifetime_seconds:
            raise ValueError("idle TTL cannot exceed maximum session lifetime")
        loop = asyncio.get_running_loop()
        waiter = _Waiter(
            "session",
            loop.create_future(),
            idle_ttl_seconds,
            max_lifetime_seconds,
        )
        await self._enqueue(waiter)
        try:
            if timeout_seconds is None:
                result = await waiter.future
            else:
                result = await asyncio.wait_for(waiter.future, timeout_seconds)
        except TimeoutError as error:
            await self._cancel_waiter(waiter)
            raise CoordinatorBusyError(
                "Timed out waiting for an exclusive Chrome Bridge session"
            ) from error
        except asyncio.CancelledError:
            await self._cancel_waiter(waiter)
            raise
        assert isinstance(result, SessionLease)
        return result

    async def heartbeat(self, session_id: str, token: str) -> SessionLease:
        async with self._guard:
            lease = self._require_session_locked(session_id, token)
            now = self._clock()
            if now >= lease.maximum_deadline:
                await self._expire_session_locked(lease)
                raise SessionNotFoundError("Exclusive session expired")
            lease.last_heartbeat = now
            return lease

    async def release_session(self, session_id: str, token: str) -> bool:
        async with self._guard:
            lease = self._active_session
            if lease is None or lease.session_id != session_id:
                return False
            if not secrets.compare_digest(lease.token, token):
                raise SessionAuthenticationError("Invalid exclusive session token")
            if lease.in_flight:
                lease.release_pending = True
            else:
                self._active_session = None
                self._grant_next_locked()
            return True

    @asynccontextmanager
    async def session_call(self, session_id: str, token: str) -> AsyncIterator[None]:
        async with self._guard:
            lease = self._require_session_locked(session_id, token)
        async with lease.call_lock:
            async with self._guard:
                lease = self._require_session_locked(session_id, token)
                now = self._clock()
                if now >= min(lease.idle_deadline, lease.maximum_deadline):
                    await self._expire_session_locked(lease)
                    raise SessionNotFoundError("Exclusive session expired")
                lease.in_flight += 1
                self._activity_locked()
            try:
                yield
            finally:
                async with self._guard:
                    lease.in_flight -= 1
                    now = self._clock()
                    if lease.release_pending or now >= min(
                        lease.idle_deadline, lease.maximum_deadline
                    ):
                        await self._expire_session_locked(lease)

    @asynccontextmanager
    async def single_call(self, timeout_seconds: float = 30) -> AsyncIterator[None]:
        loop = asyncio.get_running_loop()
        waiter = _Waiter("single", loop.create_future())
        await self._enqueue(waiter)
        try:
            await asyncio.wait_for(waiter.future, timeout_seconds)
        except TimeoutError as error:
            await self._cancel_waiter(waiter)
            raise CoordinatorBusyError(
                "Chrome Bridge is held by an exclusive session"
            ) from error
        except asyncio.CancelledError:
            await self._cancel_waiter(waiter)
            raise
        try:
            yield
        finally:
            async with self._guard:
                self._single_active = False
                self._grant_next_locked()

    async def _enqueue(self, waiter: _Waiter) -> None:
        async with self._guard:
            if self._closed:
                raise RuntimeError("Coordinator closed")
            self._waiters.append(waiter)
            self._grant_next_locked()

    async def _cancel_waiter(self, waiter: _Waiter) -> None:
        async with self._guard:
            try:
                self._waiters.remove(waiter)
            except ValueError:
                if waiter.kind == "single" and waiter.granted and self._single_active:
                    self._single_active = False
                elif (
                    waiter.kind == "session"
                    and waiter.granted
                    and self._active_session is waiter.granted_lease
                ):
                    await self._expire_session_locked(waiter.granted_lease)
            self._grant_next_locked()

    def _grant_next_locked(self) -> None:
        if self.busy:
            return
        while self._waiters:
            waiter = self._waiters.popleft()
            if waiter.future.done():
                continue
            if waiter.kind == "single":
                self._single_active = True
                waiter.granted = True
                self._activity_locked()
                waiter.future.set_result(None)
                return
            now = self._clock()
            lease = SessionLease(
                session_id=str(uuid4()),
                token=secrets.token_urlsafe(32),
                created_at=now,
                idle_ttl_seconds=waiter.idle_ttl_seconds,
                max_lifetime_seconds=waiter.max_lifetime_seconds,
                last_heartbeat=now,
            )
            self._active_session = lease
            waiter.granted = True
            waiter.granted_lease = lease
            self._activity_locked()
            waiter.future.set_result(lease)
            return

    def _require_session_locked(self, session_id: str, token: str) -> SessionLease:
        lease = self._active_session
        if lease is None or lease.session_id != session_id:
            raise SessionNotFoundError("Exclusive session is unknown or expired")
        if not secrets.compare_digest(lease.token, token):
            raise SessionAuthenticationError("Invalid exclusive session token")
        return lease

    async def _expire_session_locked(self, lease: SessionLease) -> None:
        if self._active_session is not lease:
            return
        if lease.in_flight:
            lease.release_pending = True
            return
        self._active_session = None
        self._grant_next_locked()

    async def _reap_loop(self) -> None:
        while True:
            await asyncio.sleep(1)
            async with self._guard:
                lease = self._active_session
                if lease is not None and self._clock() >= min(
                    lease.idle_deadline, lease.maximum_deadline
                ):
                    await self._expire_session_locked(lease)

    def _activity_locked(self) -> None:
        if self._on_activity is not None:
            self._on_activity()
