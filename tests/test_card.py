from bench.card import LINES, COMMANDS


def test_card_shape():
    assert len(LINES) == 30
    assert [l.id for l in LINES] == list(range(1, 31))
    assert sum(l.kind == "command" for l in LINES) == 11
    assert "continue" in COMMANDS and "stop" in COMMANDS
