"""FastAPI surface + process entry point for the hand-signals service."""

from __future__ import annotations

from fastapi import FastAPI

from . import HandSignalsService

app = FastAPI(title="Hand Signals")
_service = HandSignalsService()


@app.get("/health")
def health() -> dict[str, object]:
    status = _service.health_check()
    return {"state": status.state, "detail": status.detail}


def main() -> None:
    # TODO: run uvicorn(app) and connect to the kernel IPC bridge.
    ...


if __name__ == "__main__":
    main()
