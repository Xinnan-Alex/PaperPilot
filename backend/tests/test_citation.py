from __future__ import annotations

from paperpilot.citation import best_span


def test_best_span_finds_matching_sentence() -> None:
    text = "Intro text here. On the hard test set the model reached 91 percent. Future work."
    span = best_span(text, "how did the model do on the hard test set?")
    assert span is not None
    start, end = span
    assert text[start:end] == "On the hard test set the model reached 91 percent."


def test_best_span_no_overlap_returns_none() -> None:
    assert best_span("completely unrelated content.", "quantum chromodynamics") is None


def test_best_span_empty_inputs_return_none() -> None:
    assert best_span("", "q") is None
    assert best_span("text", "") is None


def test_best_span_only_stopwords_returns_none() -> None:
    assert best_span("Alpha beta gamma.", "the and of to") is None


def test_best_span_within_bounds() -> None:
    text = "Alpha beta. Gamma delta epsilon."
    span = best_span(text, "gamma epsilon")
    assert span is not None
    start, end = span
    assert 0 <= start < end <= len(text)
    assert text[start:end] == "Gamma delta epsilon."
