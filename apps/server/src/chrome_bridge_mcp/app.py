from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP, Image
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from .bridge import BrowserController, BrowserRegistry
from .config import Settings
from .protocol import (
    ProtocolValidationError,
    validate_extension_initial_message,
    validate_extension_runtime_message,
    validate_server_message,
)
from .security import LoopbackSecurityMiddleware


def create_app(settings: Settings) -> Any:
    registry = BrowserRegistry(timeout_seconds=settings.command_timeout_seconds)
    controller = BrowserController(registry)
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

    @mcp.tool(name="browser_instances")
    async def browser_instances() -> list[dict[str, Any]]:
        """List connected Chrome browser instances and their routing IDs."""
        return controller.instances()

    @mcp.tool(name="browser_tabs")
    async def browser_tabs(browser_id: str | None = None) -> list[dict[str, Any]]:
        """List tabs with stable IDs and separate active and targeted states."""
        return await controller.list_tabs(browser_id)

    @mcp.tool(name="browser_tab_open")
    async def browser_tab_open(
        url: str = "about:blank", active: bool = True, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Open a new Chrome tab and return the created tab."""
        return await controller.open_tab(url, active, browser_id)

    @mcp.tool(name="browser_tab_close")
    async def browser_tab_close(
        tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Close a Chrome tab by an ID returned from browser_tabs."""
        return await controller.close_tab(tab_id, browser_id)

    @mcp.tool(name="browser_tab_select")
    async def browser_tab_select(
        tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Select the page-operation target without focusing its tab or window."""
        return await controller.select_tab(tab_id, browser_id)

    @mcp.tool(name="browser_tab_activate")
    async def browser_tab_activate(
        tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Select the target, activate its Chrome tab, and focus its window."""
        return await controller.activate_tab(tab_id, browser_id)

    @mcp.tool(name="browser_snapshot")
    async def browser_snapshot(browser_id: str | None = None) -> dict[str, Any]:
        """Capture an accessibility snapshot of the selected target tab."""
        return await controller.snapshot(browser_id)

    @mcp.tool(name="browser_click")
    async def browser_click(
        element: str, ref: str, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Click the exact target snapshot ref without focusing its Chrome tab."""
        return await controller.click(element, ref, browser_id)

    @mcp.tool(name="browser_drag")
    async def browser_drag(
        startElement: str,
        startRef: str,
        endElement: str,
        endRef: str,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Drag the exact source snapshot ref to the exact target snapshot ref."""
        return await controller.drag(
            startElement, startRef, endElement, endRef, browser_id
        )

    @mcp.tool(name="browser_hover")
    async def browser_hover(
        element: str, ref: str, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Hover over the exact target snapshot ref without focusing its Chrome tab."""
        return await controller.hover(element, ref, browser_id)

    @mcp.tool(name="browser_upload_file")
    async def browser_upload_file(
        element: str,
        ref: str,
        paths: list[str],
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload local files and snapshot after the exact input dispatches change.

        Site-specific asynchronous media processing may require browser_wait followed by
        browser_snapshot.
        """
        return await controller.upload_files(element, ref, paths, browser_id)

    @mcp.tool(name="browser_type")
    async def browser_type(
        element: str, ref: str, text: str, submit: bool, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Type text into the exact editable snapshot ref and optionally press Enter."""
        return await controller.type_text(element, ref, text, submit, browser_id)

    @mcp.tool(name="browser_select_option")
    async def browser_select_option(
        element: str, ref: str, values: list[str], browser_id: str | None = None
    ) -> dict[str, Any]:
        """Select exact option values in the referenced select element."""
        return await controller.select_option(element, ref, values, browser_id)

    @mcp.tool(name="browser_press_key")
    async def browser_press_key(key: str, browser_id: str | None = None) -> str:
        """Press a key or key chord on the target page without focusing its tab."""
        return await controller.press_key(key, browser_id)

    @mcp.tool(name="browser_navigate")
    async def browser_navigate(
        url: str, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Navigate the target tab to an HTTP(S) URL and return its snapshot."""
        return await controller.navigate(url, browser_id)

    @mcp.tool(name="browser_go_back")
    async def browser_go_back(browser_id: str | None = None) -> dict[str, Any]:
        """Navigate the target tab backward and return its snapshot."""
        return await controller.go_back(browser_id)

    @mcp.tool(name="browser_go_forward")
    async def browser_go_forward(browser_id: str | None = None) -> dict[str, Any]:
        """Navigate the target tab forward and return its snapshot."""
        return await controller.go_forward(browser_id)

    @mcp.tool(name="browser_wait")
    async def browser_wait(time: float, browser_id: str | None = None) -> str:
        """Wait up to 10 seconds for the selected target page."""
        return await controller.wait(time, browser_id)

    @mcp.tool(name="browser_record_video")
    async def browser_record_video(
        filename: str, duration: float, browser_id: str | None = None
    ) -> dict[str, Any]:
        """Record the current target as a silent WebM in Downloads/chrome-bridge."""
        return await controller.record_video(filename, duration, browser_id)

    @mcp.tool(name="browser_screenshot")
    async def browser_screenshot(browser_id: str | None = None) -> Image:
        """Capture the target viewport as a PNG without focusing its tab."""
        return Image(data=await controller.screenshot(browser_id), format="png")

    @mcp.tool(name="browser_get_console_logs")
    async def browser_get_console_logs(browser_id: str | None = None) -> str:
        """Get up to 100 console and exception entries from the target page."""
        entries = await controller.console_logs(browser_id)
        return "\n".join(
            json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
            for entry in entries
        )

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
    app.router.routes.insert(0, WebSocketRoute("/extension", extension_endpoint))
    app.router.routes.insert(0, Route("/health", health, methods=["GET"]))
    return LoopbackSecurityMiddleware(app)
