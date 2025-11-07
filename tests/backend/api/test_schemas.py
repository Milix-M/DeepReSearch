from datetime import datetime, timezone

from src.backend.api import schemas


def test_interrupt_payload_roundtrip():
    payload = schemas.InterruptPayload(id="x", value={"foo": 1})
    assert payload.model_dump()["id"] == "x"


def test_health_response_structure():
    response = schemas.HealthResponse(
        status="ok",
        timestamp=datetime.now(timezone.utc),
        details={"threads": 1},
    )
    assert response.status == "ok"


def test_thread_list_response_counts():
    listing = schemas.ThreadListResponse(
        active_thread_ids=["a"],
        pending_interrupt_ids=[],
        active_count=1,
        pending_count=0,
    )
    assert listing.active_count == len(listing.active_thread_ids)


def test_state_response_includes_optional_interrupt():
    payload = schemas.StateResponse(
        thread_id="t",
        status="done",
        state={"value": 1},
        pending_interrupt=None,
    )
    assert payload.thread_id == "t"
