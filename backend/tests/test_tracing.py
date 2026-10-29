"""Langfuse tracing produces the expected spans, using an in-memory exporter (no account, no network)."""
import importlib
import logging

import pytest


@pytest.fixture
def traced(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    monkeypatch.setenv("LANGFUSE_BASE_URL", "http://127.0.0.1:9")  # unreachable on purpose
    logging.getLogger("langfuse").setLevel(logging.CRITICAL)
    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    mem = InMemorySpanExporter()
    tp = TracerProvider()
    tp.add_span_processor(SimpleSpanProcessor(mem))
    Langfuse(tracer_provider=tp, should_export_span=lambda s: False)  # record in memory, never send
    import tracing
    importlib.reload(tracing)
    yield tracing, mem
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY")
    importlib.reload(tracing)


def test_run_is_one_trace_with_nested_steps(traced):
    tracing, mem = traced
    with tracing.span("Handoff Lab run") as root:
        with tracing.generation("Customer service agent", model="m") as g:
            g.update(output={"escalate": True}, usage_details={"input": 10, "output": 5})
        with tracing.span("Deterministic checks"):
            pass
        root.update(output="done")
    spans = {s.name: s for s in mem.get_finished_spans()}
    assert set(spans) == {"Handoff Lab run", "Customer service agent", "Deterministic checks"}
    root_id = spans["Handoff Lab run"].context.span_id
    assert spans["Customer service agent"].parent.span_id == root_id
    assert len({s.context.trace_id for s in spans.values()}) == 1


def test_inactive_span_records_nothing(traced):
    tracing, mem = traced
    with tracing.span("demo run", active=False) as s:
        s.update(output="ignored")
    assert mem.get_finished_spans() == ()


def test_tracing_off_without_keys(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    import tracing
    assert not tracing.enabled()
    with tracing.generation("x") as g:
        g.update(output=1)  # no-op, must not raise
    assert tracing.trace_url() is None
