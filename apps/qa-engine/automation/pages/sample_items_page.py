"""Page object for the demo target app's items page (FR-AUT-001, FR-AUT-003).

Contract with the sample app (built by a separate module):
``/items`` serves an input ``[data-testid=new-item]``, an add button with role
``button`` and accessible name ``Add``, list items ``[data-testid=item]`` and
per-item delete buttons with role ``button`` and accessible name ``Delete``.
"""

from __future__ import annotations

from playwright.sync_api import Locator, Page

from automation.pages.base_page import BasePage


class SampleItemsPage(BasePage):
    """Items (todo-style) page of the sample application under test."""

    path = "/items"

    def __init__(self, page: Page, base_url: str) -> None:
        super().__init__(page, base_url)
        self.new_item_input: Locator = self.by_test_id("new-item")
        self.add_button: Locator = self.by_role("button", name="Add")
        self.items: Locator = self.by_test_id("item")
        self.delete_buttons: Locator = self.by_role("button", name="Delete")

    def add_item(self, text: str) -> None:
        """Type an item into the new-item input and click Add (instrumented,
        FR-EXE-007)."""
        self.fill(self.new_item_input, text, "new item")
        self.click(self.add_button, "Add")

    def delete_item(self, index: int = 0) -> None:
        """Click the Delete button of the item at ``index``.

        Prefer :meth:`delete_item_by_text` where possible — index-based
        selection is order-dependent (see the locator policy, FR-AUT-003).
        """
        self.click(self.delete_buttons.nth(index), f"Delete item #{index}")

    def delete_item_by_text(self, text: str) -> None:
        """Click the Delete button inside the item containing ``text``.

        Text-scoped deletion is stable regardless of list order (FR-AUT-003).
        """
        self.click(
            self.item_with_text(text).get_by_role("button", name="Delete"),
            f"Delete '{text}'",
        )

    def item_with_text(self, text: str) -> Locator:
        """Locator for the list item(s) whose text contains ``text``."""
        return self.items.filter(has_text=text)

    def assert_item_present(self, text: str) -> None:
        """Web-first assertion that an item containing ``text`` is visible."""
        self.assert_visible(self.item_with_text(text))

    def assert_item_absent(self, text: str) -> None:
        """Web-first assertion that no item containing ``text`` remains."""
        self.assert_count(self.item_with_text(text), 0)
