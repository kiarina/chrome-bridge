from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from .bridge import BrowserController


class DirectMethodNotFoundError(ValueError):
    pass


class DirectArgumentError(ValueError):
    pass


class DirectDispatcher:
    """Invoke the transport-neutral controller with MCP-compatible arguments."""

    def __init__(self, controller: BrowserController, tool_manager: Any) -> None:
        self._controller = controller
        self._tools = {tool.name: tool for tool in tool_manager.list_tools()}

    def definitions(self) -> list[dict[str, Any]]:
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.parameters,
            }
            for tool in self._tools.values()
        ]

    async def call(self, method: str, arguments: Mapping[str, Any]) -> Any:
        tool = self._tools.get(method)
        if tool is None:
            raise DirectMethodNotFoundError(f"Unknown browser method: {method}")
        try:
            parsed = tool.fn_metadata.arg_model.model_validate(dict(arguments))
        except ValidationError as error:
            raise DirectArgumentError(str(error)) from error
        values = parsed.model_dump()
        return await self._dispatch(method, values)

    async def _dispatch(self, method: str, values: dict[str, Any]) -> Any:
        controller = self._controller
        browser_id = values.get("browser_id")
        video = values.get("video_filename")
        if method == "browser_instances":
            return controller.instances()
        if method == "browser_tabs":
            return await controller.list_tabs(browser_id)
        if method == "browser_tab_open":
            return await controller.open_tab(
                values["url"], values["active"], browser_id
            )
        if method == "browser_tab_close":
            return await controller.close_tab(values["tab_id"], browser_id)
        if method == "browser_tab_select":
            return await controller.select_tab(values["tab_id"], browser_id)
        if method == "browser_tab_activate":
            return await controller.activate_tab(values["tab_id"], browser_id)
        if method == "browser_snapshot":
            return await controller.snapshot(browser_id)
        if method == "browser_click":
            return await controller.click(
                values["element"], values["ref"], browser_id, video
            )
        if method == "browser_hover":
            return await controller.hover(
                values["element"], values["ref"], browser_id, video
            )
        if method == "browser_drag":
            return await controller.drag(
                values["startElement"],
                values["startRef"],
                values["endElement"],
                values["endRef"],
                browser_id,
                video,
            )
        if method == "browser_upload_file":
            return await controller.upload_files(
                values["element"],
                values["ref"],
                values["paths"],
                browser_id,
                video,
            )
        if method == "browser_type":
            return await controller.type_text(
                values["element"],
                values["ref"],
                values["text"],
                values["submit"],
                browser_id,
                video,
            )
        if method == "browser_select_option":
            return await controller.select_option(
                values["element"],
                values["ref"],
                values["values"],
                browser_id,
                video,
            )
        if method == "browser_press_key":
            return await controller.press_key_result(values["key"], browser_id, video)
        if method == "browser_navigate":
            return await controller.navigate(values["url"], browser_id, video)
        if method == "browser_go_back":
            return await controller.go_back(browser_id, video)
        if method == "browser_go_forward":
            return await controller.go_forward(browser_id, video)
        if method == "browser_wait":
            return await controller.wait_result(values["time"], browser_id, video)
        if method == "browser_wait_for":
            return await controller.wait_for(
                values["text"],
                values["state"],
                values["timeout"],
                browser_id,
                video,
            )
        if method == "browser_download_file":
            return await controller.download_file(
                values["element"], values["ref"], values["timeout"], browser_id
            )
        if method == "browser_record_video":
            return await controller.record_video(
                values["filename"], values["duration"], browser_id
            )
        if method == "browser_screenshot":
            return await controller.screenshot_result(browser_id)
        if method == "browser_get_console_logs":
            return await controller.console_logs(browser_id)
        raise DirectMethodNotFoundError(f"Unknown browser method: {method}")
