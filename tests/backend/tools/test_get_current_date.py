from datetime import date
from types import SimpleNamespace

from src.backend.tools import get_current_date as module


def test_get_current_date_returns_today(monkeypatch):
    monkeypatch.setattr(
        module,
        "datetime",
        SimpleNamespace(date=SimpleNamespace(today=lambda: date(2024, 1, 2))),
    )
    assert module.get_current_date.invoke({}) == date(2024, 1, 2)
