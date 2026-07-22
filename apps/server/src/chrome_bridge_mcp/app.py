from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from functools import wraps
from importlib.metadata import version
from typing import Any
from uuid import uuid4

from mcp.server.fastmcp import FastMCP, Image
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from .bridge import (
    BrowserController,
    BrowserRegistry,
    ExtensionCommandError,
    ExtensionUnavailableError,
)
from .config import Settings
from .coordination import (
    CoordinatorBusyError,
    OperationCoordinator,
    SessionAuthenticationError,
    SessionNotFoundError,
)
from .direct_api import DirectArgumentError, DirectDispatcher, DirectMethodNotFoundError
from .protocol import (
    ProtocolValidationError,
    validate_extension_initial_message,
    validate_extension_runtime_message,
    validate_server_message,
)
from .security import LoopbackSecurityMiddleware


SERVER_VERSION = version("chrome-bridge-mcp")
API_VERSION = 1


def create_app(settings: Settings, request_shutdown: Any | None = None) -> Any:
    last_activity = time.monotonic()

    def mark_activity() -> None:
        nonlocal last_activity
        last_activity = time.monotonic()

    registry = BrowserRegistry(timeout_seconds=settings.command_timeout_seconds)
    controller = BrowserController(registry)
    coordinator = OperationCoordinator(on_activity=mark_activity)
    mcp = FastMCP(
        "chrome-bridge",
        instructions=(
            "Control tabs in connected Chrome browsers. Call browser_instances and pass "
            "browser_id when multiple browsers are connected. Use browser_tab_select to "
            "choose the page-operation target without focusing it. Use browser_tab_activate "
            "only when the user needs to see the target tab. Use browser_upload_file with "
            "absolute local paths and the exact ref that opens a file chooser."
        ),
        stateless_http=True,
        json_response=True,
        streamable_http_path="/mcp",
    )

    def tool(*, name: str) -> Any:
        def decorate(function: Any) -> Any:
            @wraps(function)
            async def coordinated(*args: Any, **kwargs: Any) -> Any:
                async with coordinator.single_call(
                    settings.operation_wait_timeout_seconds
                ):
                    return await function(*args, **kwargs)

            return mcp.tool(name=name)(coordinated)

        return decorate

    @tool(name="browser_instances")
    async def browser_instances() -> list[dict[str, Any]]:
        """List connected Chrome browser instances and their routing IDs."""
        return controller.instances()

    @tool(name="browser_tabs")
    async def browser_tabs(browser_id: str | None = None) -> list[dict[str, Any]]:
        """List tabs with stable IDs and separate active and targeted states."""
        return await controller.list_tabs(browser_id)

    @tool(name="browser_tab_open")
    async def browser_tab_open(
        url: str = "about:blank", active: bool = True, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Open a new Chrome tab and return the created tab."""
        return await controller.open_tab(url, active, browser_id)

    @tool(name="browser_tab_close")
    async def browser_tab_close(
        tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Close a Chrome tab by an ID returned from browser_tabs."""
        return await controller.close_tab(tab_id, browser_id)

    @tool(name="browser_tab_select")
    async def browser_tab_select(
        tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Select the page-operation target without focusing its tab or window."""
        return await controller.select_tab(tab_id, browser_id)

    @tool(name="browser_tab_activate")
    async def browser_tab_activate(
        tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Select the target, activate its Chrome tab, and focus its window."""
        return await controller.activate_tab(tab_id, browser_id)

    @tool(name="browser_snapshot")
    async def browser_snapshot(browser_id: str | None = None) -> dict[str, Any]:
        """Capture an accessibility snapshot of the selected target tab."""
        return await controller.snapshot(browser_id)

    @tool(name="browser_click")
    async def browser_click(
        element: str,
        ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Click an exact target ref, optionally recording it to a WebM."""
        return await controller.click(element, ref, browser_id, video_filename)

    @tool(name="browser_drag")
    async def browser_drag(
        startElement: str,
        startRef: str,
        endElement: str,
        endRef: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Drag between exact refs, optionally recording it to a WebM."""
        return await controller.drag(
            startElement,
            startRef,
            endElement,
            endRef,
            browser_id,
            video_filename,
        )

    @tool(name="browser_hover")
    async def browser_hover(
        element: str,
        ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Hover an exact target ref, optionally recording it to a WebM."""
        return await controller.hover(element, ref, browser_id, video_filename)

    @tool(name="browser_upload_file")
    async def browser_upload_file(
        element: str,
        ref: str,
        paths: list[str],
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload local files, optionally recording through input change and snapshot.

        Site-specific asynchronous media processing may require browser_wait followed by
        browser_snapshot.
        """
        return await controller.upload_files(
            element, ref, paths, browser_id, video_filename
        )

    @tool(name="browser_type")
    async def browser_type(
        element: str,
        ref: str,
        text: str,
        submit: bool,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Type into an exact ref, optionally recording it to a WebM."""
        return await controller.type_text(
            element, ref, text, submit, browser_id, video_filename
        )

    @tool(name="browser_select_option")
    async def browser_select_option(
        element: str,
        ref: str,
        values: list[str],
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Select exact values, optionally recording it to a WebM."""
        return await controller.select_option(
            element, ref, values, browser_id, video_filename
        )

    @tool(name="browser_press_key")
    async def browser_press_key(
        key: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> str | dict[str, Any]:
        """Press a key or chord, optionally recording it to a WebM."""
        return await controller.press_key(key, browser_id, video_filename)

    @tool(name="browser_navigate")
    async def browser_navigate(
        url: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Navigate to an HTTP(S) URL, optionally recording through the snapshot."""
        return await controller.navigate(url, browser_id, video_filename)

    @tool(name="browser_go_back")
    async def browser_go_back(
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Navigate backward, optionally recording through the snapshot."""
        return await controller.go_back(browser_id, video_filename)

    @tool(name="browser_go_forward")
    async def browser_go_forward(
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Navigate forward, optionally recording through the snapshot."""
        return await controller.go_forward(browser_id, video_filename)

    @tool(name="browser_wait")
    async def browser_wait(
        time: float,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> str | dict[str, Any]:
        """Wait up to 10 seconds, optionally recording the target to a WebM."""
        return await controller.wait(time, browser_id, video_filename)

    @tool(name="browser_record_video")
    async def browser_record_video(
        filename: str, duration: float, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Record the current target as a silent WebM in Downloads/chrome-bridge."""
        return await controller.record_video(filename, duration, browser_id)

    @tool(name="browser_screenshot")
    async def browser_screenshot(browser_id: str | None = None) -> Image:
        """Capture the target viewport as a PNG without focusing its tab."""
        return Image(data=await controller.screenshot(browser_id), format="png")

    @tool(name="browser_get_console_logs")
    async def browser_get_console_logs(browser_id: str | None = None) -> str:
        """Get up to 100 console and exception entries from the target page."""
        entries = await controller.console_logs(browser_id)
        return "\n".join(
            json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
            for entry in entries
        )

    dispatcher = DirectDispatcher(controller, mcp._tool_manager)
    instance_id = str(uuid4())

    async def api_meta(_: Request) -> JSONResponse:
        return JSONResponse(
            {
                "service": "chrome-bridge",
                "apiVersion": API_VERSION,
                "serverVersion": SERVER_VERSION,
                "instanceId": instance_id,
                "mode": "managed" if settings.managed else "persistent",
                "extensionConnected": registry.connected,
                "connectedBrowserCount": registry.connected_count,
            }
        )

    async def api_tools(_: Request) -> JSONResponse:
        return JSONResponse({"tools": dispatcher.definitions()})

    async def api_session_create(request: Request) -> JSONResponse:
        try:
            body = await _request_object(request)
            idle_ttl = _number_option(
                body,
                "idleTtlSeconds",
                settings.session_idle_ttl_seconds,
                minimum=30,
                maximum=300,
            )
            maximum = _number_option(
                body,
                "maxLifetimeSeconds",
                settings.session_max_lifetime_seconds,
                minimum=60,
                maximum=3600,
            )
            wait_timeout = body.get("waitTimeoutSeconds")
            if wait_timeout is not None:
                wait_timeout = _finite_number(
                    wait_timeout, "waitTimeoutSeconds", minimum=0, maximum=600
                )
            lease = await coordinator.acquire_session(
                idle_ttl_seconds=idle_ttl,
                max_lifetime_seconds=maximum,
                timeout_seconds=wait_timeout,
            )
            return JSONResponse({"ok": True, "result": lease.as_dict()})
        except Exception as error:
            return _api_error(error)

    async def api_session_heartbeat(request: Request) -> JSONResponse:
        try:
            session_id = request.path_params["session_id"]
            token = _session_token(request)
            lease = await coordinator.heartbeat(session_id, token)
            return JSONResponse(
                {
                    "ok": True,
                    "result": {
                        "sessionId": lease.session_id,
                        "idleTtlSeconds": lease.idle_ttl_seconds,
                    },
                }
            )
        except Exception as error:
            return _api_error(error)

    async def api_session_release(request: Request) -> JSONResponse:
        try:
            released = await coordinator.release_session(
                request.path_params["session_id"], _session_token(request)
            )
            return JSONResponse({"ok": True, "result": {"released": released}})
        except Exception as error:
            return _api_error(error)

    async def api_call(request: Request) -> JSONResponse:
        entered = False
        try:
            body = await _request_object(request)
            if set(body) != {"method", "arguments"}:
                raise DirectArgumentError("body must contain method and arguments")
            method = body["method"]
            arguments = body["arguments"]
            if not isinstance(method, str) or not isinstance(arguments, dict):
                raise DirectArgumentError(
                    "method must be a string and arguments must be an object"
                )
            session_id = request.headers.get("x-chrome-bridge-session")
            authorization = request.headers.get("authorization")
            if session_id is None and authorization is None:
                async with coordinator.single_call(
                    settings.operation_wait_timeout_seconds
                ):
                    entered = True
                    result = await dispatcher.call(method, arguments)
            elif session_id is not None and authorization is not None:
                async with coordinator.session_call(
                    session_id, _session_token(request)
                ):
                    entered = True
                    result = await dispatcher.call(method, arguments)
            else:
                raise SessionAuthenticationError(
                    "Session ID and bearer token must be provided together"
                )
            return JSONResponse({"ok": True, "result": result})
        except Exception as error:
            outcome_unknown = entered and (
                isinstance(error, ExtensionUnavailableError)
                or str(error).startswith("Operation outcome unknown:")
            )
            return _api_error(error, outcome_unknown=outcome_unknown)

    async def health(_: Request) -> JSONResponse:
        return JSONResponse(
            {
                "status": "ok",
                "extensionConnected": registry.connected,
                "connectedBrowserCount": registry.connected_count,
                "extension": registry.extension_info,
            }
        )

    async def extension_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        connection = None
        try:
            try:
                hello = await websocket.receive_json()
            except json.JSONDecodeError:
                await websocket.close(code=1002, reason="Malformed extension JSON")
                return
            try:
                validate_extension_initial_message(hello)
            except ProtocolValidationError as error:
                await websocket.close(code=1002, reason=str(error)[:123])
                return
            connection = await registry.attach(websocket, hello)
            while True:
                try:
                    message = await websocket.receive_json()
                except json.JSONDecodeError:
                    await websocket.close(code=1002, reason="Malformed extension JSON")
                    return
                try:
                    validate_extension_runtime_message(message)
                    reply = connection.receive(message)
                except ProtocolValidationError as error:
                    await websocket.close(code=1002, reason=str(error)[:123])
                    return
                if reply is not None:
                    validate_server_message(reply)
                    await websocket.send_json(reply)
        except WebSocketDisconnect:
            pass
        finally:
            if connection is not None:
                await registry.detach(connection, websocket)

    app = mcp.streamable_http_app()
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application: Any) -> Any:
        async with original_lifespan(application):
            coordinator.start()
            idle_task: asyncio.Task[None] | None = None
            if settings.managed and request_shutdown is not None:
                idle_task = asyncio.create_task(
                    _managed_idle_monitor(
                        coordinator,
                        lambda: last_activity,
                        settings.managed_idle_timeout_seconds,
                        request_shutdown,
                    )
                )
            try:
                yield
            finally:
                if idle_task is not None:
                    idle_task.cancel()
                    await asyncio.gather(idle_task, return_exceptions=True)
                await coordinator.close()

    app.router.lifespan_context = lifespan
    app.router.routes.insert(0, WebSocketRoute("/extension", extension_endpoint))
    app.router.routes.insert(0, Route("/health", health, methods=["GET"]))
    app.router.routes.insert(0, Route("/api/v1/meta", api_meta, methods=["GET"]))
    app.router.routes.insert(0, Route("/api/v1/tools", api_tools, methods=["GET"]))
    app.router.routes.insert(
        0, Route("/api/v1/sessions", api_session_create, methods=["POST"])
    )
    app.router.routes.insert(
        0,
        Route(
            "/api/v1/sessions/{session_id}/heartbeat",
            api_session_heartbeat,
            methods=["POST"],
        ),
    )
    app.router.routes.insert(
        0,
        Route(
            "/api/v1/sessions/{session_id}",
            api_session_release,
            methods=["DELETE"],
        ),
    )
    app.router.routes.insert(0, Route("/api/v1/call", api_call, methods=["POST"]))
    return LoopbackSecurityMiddleware(app)


async def _request_object(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise DirectArgumentError("request body must be valid JSON") from error
    if not isinstance(body, dict):
        raise DirectArgumentError("request body must be a JSON object")
    return body


def _session_token(request: Request) -> str:
    value = request.headers.get("authorization", "")
    scheme, separator, token = value.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token:
        raise SessionAuthenticationError("A bearer session token is required")
    return token


def _number_option(
    body: dict[str, Any],
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    return _finite_number(body.get(name, default), name, minimum, maximum)


def _finite_number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not minimum <= float(value) <= maximum
    ):
        raise DirectArgumentError(
            f"{name} must be between {minimum:g} and {maximum:g} seconds"
        )
    return float(value)


def _api_error(error: Exception, *, outcome_unknown: bool = False) -> JSONResponse:
    status = 500
    code = "internal_error"
    retryable = False
    if isinstance(error, DirectMethodNotFoundError):
        status, code = 404, "method_not_found"
    elif isinstance(error, (DirectArgumentError, ValueError)):
        status, code = 400, "invalid_argument"
    elif isinstance(error, SessionAuthenticationError):
        status, code = 401, "invalid_session_token"
    elif isinstance(error, SessionNotFoundError):
        status, code = 409, "session_expired"
    elif isinstance(error, CoordinatorBusyError):
        status, code, retryable = 409, "busy", True
    elif isinstance(error, ExtensionUnavailableError):
        status, code, retryable = 503, "extension_unavailable", True
    elif isinstance(error, ExtensionCommandError):
        status, code = 502, "extension_command_failed"
    return JSONResponse(
        {
            "ok": False,
            "error": {
                "code": code,
                "message": str(error) or error.__class__.__name__,
                "retryable": retryable and not outcome_unknown,
                "outcomeUnknown": outcome_unknown,
            },
        },
        status_code=status,
    )


async def _managed_idle_monitor(
    coordinator: OperationCoordinator,
    last_activity: Any,
    timeout_seconds: float,
    request_shutdown: Any,
) -> None:
    while True:
        await asyncio.sleep(min(1.0, timeout_seconds))
        if (
            not coordinator.busy
            and coordinator.waiter_count == 0
            and time.monotonic() - last_activity() >= timeout_seconds
        ):
            request_shutdown()
            return
