"""The 30-line reading card used to record speech benchmark clips."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class CardLine:
    id: int
    text: str
    kind: Literal["command", "ordinary"]


_RAW: list[tuple[Literal["command", "ordinary"], str]] = [
    ("command", "continue"),
    ("ordinary", "Ask the coordinator what the refactor subagent is doing right now."),
    ("command", "stop"),
    ("ordinary", "Is the LiveKit server still running on the Oracle box?"),
    ("ordinary", "Let's keep the speech models off the laptop because of the memory crashes."),
    ("command", "new conversation"),
    ("ordinary", "Have a subagent write the tests first, then run them in the background."),
    ("ordinary", "What did the Whisper benchmark say about word error rate on small dot en?"),
    ("command", "continue"),
    ("ordinary", "Don't read the diff out loud, just tell me if it touches the gate."),
    ("ordinary", "Push the branch and open a pull request, but don't merge it."),
    ("command", "stop"),
    ("ordinary", "Compare Kokoro and Piper on time to first audio."),
    ("ordinary", "Check Tailscale and tell me whether the phone can reach the voice side."),
    ("command", "audio off"),
    ("ordinary", "The round trip was three point eight seconds, which is fine for now."),
    ("ordinary", "Rebase the worktree onto main and resolve the conflicts in session dot ts."),
    ("command", "continue"),
    ("ordinary", "Why did the agent host restart the coordinator ten minutes ago?"),
    ("ordinary", "Use Sonnet for this one and keep the effort on default."),
    ("command", "switch project"),
    ("ordinary", "Summarise what happened while I was in the tunnel."),
    ("ordinary", "Add a to-do item to check SideStore before the seven day signature runs out."),
    ("command", "audio on"),
    ("ordinary", "Drop the background job that is profiling the memory guard."),
    ("ordinary", "What's the p fifty latency on the ARM CPU with Parakeet?"),
    ("command", "stop"),
    ("ordinary", "Explain the trade-off between holding the gate and denying it."),
    ("command", "continue"),
    ("ordinary", "That's all for now, tell me when the build finishes."),
]

LINES: list[CardLine] = [
    CardLine(id=i, text=text, kind=kind)
    for i, (kind, text) in enumerate(_RAW, start=1)
]

COMMANDS: set[str] = {line.text for line in LINES if line.kind == "command"}
