"""The rule catalog as JSON-ready data, shared by every server (the stdlib one and the FastAPI backend)."""

from __future__ import annotations

from .detector import DEFAULT_RULES, LEVELS, OBFUSCATION_RULE


def rules_payload(block_threshold: int) -> dict:
    """Every pattern rule, then the derived obfuscation rule, plus the level bands and the blocking threshold."""
    def row(rule, derived):
        return {"id": rule.id, "name": rule.name, "category": rule.category, "weight": rule.weight,
                "description": rule.description, "derived": derived}
    return {"rules": [row(r, False) for r in DEFAULT_RULES] + [row(OBFUSCATION_RULE, True)],
            "levels": [{"name": name, "min": floor} for floor, name in reversed(LEVELS)],
            "block_threshold": block_threshold}
