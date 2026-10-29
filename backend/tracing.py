"""Optional Langfuse tracing: one trace per run, with a generation per model call.

Off unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set (LANGFUSE_BASE_URL picks
the region or a self-hosted server). When off, every helper is a no-op, so callers
never need to check.
"""
import os
from contextlib import nullcontext


def enabled() -> bool:
    return bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))


class _Noop:
    def update(self, **_):
        pass


_client = None


def _lf():
    global _client
    if _client is None:
        from langfuse import get_client  # imported lazily so the dependency stays optional
        _client = get_client()
    return _client


def span(name: str, active: bool = True, **kw):
    """active=False gives a no-op even when tracing is on (used to keep demo runs untraced)."""
    if not (active and enabled()):
        return nullcontext(_Noop())
    return _lf().start_as_current_observation(name=name, as_type="span", **kw)


def generation(name: str, **kw):
    return _lf().start_as_current_observation(name=name, as_type="generation", **kw) if enabled() else nullcontext(_Noop())


def score(name: str, value: float, comment: str | None = None) -> None:
    if enabled():
        _lf().score_current_trace(name=name, value=value, comment=comment)


def trace_url() -> str | None:
    return _lf().get_trace_url() if enabled() else None


def flush() -> None:
    if enabled():
        _lf().flush()
