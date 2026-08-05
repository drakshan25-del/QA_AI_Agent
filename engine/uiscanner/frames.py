"""Frame discovery and frame-aware locator scoping (§14).

Elements inside an iframe are only reachable through a ``frameLocator`` chain,
so each discovered frame is described by the ordered list of iframe selectors
that leads to it. That chain is stored on every locator generated inside the
frame, which is what stops a locator from one frame being applied to another.

Selectors for the iframes themselves are chosen with the same
stability-first preference as element locators: a title or name attribute
beats an id, which beats a src, which beats positional selection.
"""

from __future__ import annotations

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Frame, Page

from engine.uiscanner.types import MAX_FRAMES, FrameDefinition

_IFRAME_DESCRIPTOR_JS = r"""
(el) => ({
  title: el.getAttribute('title') || '',
  name: el.getAttribute('name') || '',
  id: el.id || '',
  src: el.getAttribute('src') || '',
  testId: el.getAttribute('data-testid') || '',
})
"""


def _quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def frame_selector(descriptor: dict[str, str], fallback_index: int) -> str:
    """Most stable CSS selector that identifies one iframe element."""
    if descriptor.get("testId"):
        return f'iframe[data-testid="{_quote(descriptor["testId"])}"]'
    if descriptor.get("title"):
        return f'iframe[title="{_quote(descriptor["title"])}"]'
    if descriptor.get("name"):
        return f'iframe[name="{_quote(descriptor["name"])}"]'
    if descriptor.get("id"):
        return f'iframe[id="{_quote(descriptor["id"])}"]'
    if descriptor.get("src"):
        return f'iframe[src="{_quote(descriptor["src"])}"]'
    # Nothing identifying: positional selection, explicitly the weakest option.
    return f"iframe >> nth={fallback_index}"


def discover_frames(page: Page) -> tuple[list[tuple[Frame, FrameDefinition]], list[str]]:
    """Return every reachable frame with its rebuildable selector chain.

    The main document is always the first entry with an empty chain. Frames
    that cannot be introspected (detached, cross-origin isolated) are reported
    as warnings instead of failing the scan.
    """
    warnings: list[str] = []
    found: list[tuple[Frame, FrameDefinition]] = [
        (
            page.main_frame,
            FrameDefinition(
                path=[],
                url=page.url,
                name="",
                title="main document",
                selector="",
                parent_index=-1,
                index=0,
            ),
        )
    ]
    by_frame: dict[Frame, FrameDefinition] = {page.main_frame: found[0][1]}

    for frame in page.frames:
        if frame is page.main_frame:
            continue
        if len(found) >= MAX_FRAMES:
            warnings.append(
                f"Frame limit reached ({MAX_FRAMES}); remaining frames were not scanned."
            )
            break
        parent = frame.parent_frame
        parent_def = by_frame.get(parent) if parent else None
        if parent_def is None:
            warnings.append(
                f"Frame '{frame.name or frame.url}' has no scanned parent frame; skipped."
            )
            continue
        try:
            element = frame.frame_element()
            descriptor = element.evaluate(_IFRAME_DESCRIPTOR_JS)
            sibling_index = max(0, len([f for f in found if f[1].parent_index == parent_def.index]))
            selector = frame_selector(descriptor, sibling_index)
            title = descriptor.get("title", "")
            name = descriptor.get("name", "") or frame.name
        except PlaywrightError as exc:
            warnings.append(
                f"Frame '{frame.name or frame.url}' could not be inspected and was "
                f"skipped: {exc}"
            )
            continue

        definition = FrameDefinition(
            path=[*parent_def.path, selector],
            url=frame.url,
            name=name,
            title=title,
            selector=selector,
            parent_index=parent_def.index,
            index=len(found),
        )
        by_frame[frame] = definition
        found.append((frame, definition))

    return found, warnings
