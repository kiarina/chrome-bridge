from __future__ import annotations

import asyncio

import pytest

from chrome_bridge_mcp.coordination import (
    CoordinatorBusyError,
    OperationCoordinator,
    SessionNotFoundError,
)


async def test_single_calls_are_fifo() -> None:
    coordinator = OperationCoordinator()
    order: list[str] = []

    async def run(name: str) -> None:
        async with coordinator.single_call(1):
            order.append(f"{name}:start")
            await asyncio.sleep(0.01)
            order.append(f"{name}:end")

    await asyncio.gather(run("a"), run("b"), run("c"))
    assert order == [
        "a:start",
        "a:end",
        "b:start",
        "b:end",
        "c:start",
        "c:end",
    ]


async def test_session_holds_single_calls_until_release() -> None:
    coordinator = OperationCoordinator()
    lease = await coordinator.acquire_session(
        idle_ttl_seconds=1,
        max_lifetime_seconds=10,
        timeout_seconds=1,
    )
    entered = asyncio.Event()

    async def single() -> None:
        async with coordinator.single_call(1):
            entered.set()

    task = asyncio.create_task(single())
    await asyncio.sleep(0)
    assert not entered.is_set()
    async with coordinator.session_call(lease.session_id, lease.token):
        pass
    assert not entered.is_set()
    assert await coordinator.release_session(lease.session_id, lease.token)
    await task
    assert entered.is_set()


async def test_session_heartbeat_and_expiry() -> None:
    now = 10.0
    coordinator = OperationCoordinator(clock=lambda: now)
    lease = await coordinator.acquire_session(
        idle_ttl_seconds=2,
        max_lifetime_seconds=10,
        timeout_seconds=1,
    )
    now = 11.5
    await coordinator.heartbeat(lease.session_id, lease.token)
    now = 13.6
    with pytest.raises(SessionNotFoundError):
        async with coordinator.session_call(lease.session_id, lease.token):
            pass


async def test_single_call_times_out_behind_session() -> None:
    coordinator = OperationCoordinator()
    lease = await coordinator.acquire_session(
        idle_ttl_seconds=1,
        max_lifetime_seconds=10,
        timeout_seconds=1,
    )
    with pytest.raises(CoordinatorBusyError):
        async with coordinator.single_call(0.01):
            pass
    await coordinator.release_session(lease.session_id, lease.token)


async def test_cancelled_waiter_does_not_block_next_request() -> None:
    coordinator = OperationCoordinator()
    lease = await coordinator.acquire_session(
        idle_ttl_seconds=1,
        max_lifetime_seconds=10,
        timeout_seconds=1,
    )
    waiter = asyncio.create_task(
        coordinator.acquire_session(
            idle_ttl_seconds=1,
            max_lifetime_seconds=10,
            timeout_seconds=None,
        )
    )
    await asyncio.sleep(0)
    waiter.cancel()
    await asyncio.gather(waiter, return_exceptions=True)
    await coordinator.release_session(lease.session_id, lease.token)
    async with coordinator.single_call(1):
        pass
