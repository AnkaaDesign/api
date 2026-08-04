"""Painting production analysis engine.

Pure image -> geometry/semantics pipeline. No database access, no business
rules: it measures and describes; the API layer decides and prices.
"""

from .version import ENGINE_VERSION

__all__ = ["ENGINE_VERSION"]
