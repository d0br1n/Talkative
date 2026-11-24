# Background subagents under headless stream-json

Spike: `spikes/background-jobs/check.py` (Python, standard library). Date 2026-11-24, `claude` 2.1.329, model `sonnet`, owner's normal login.

## Setup (exact)

    claude -p --input-format stream-json --output-format stream-json --verbose \
      --model sonnet --permission-mode bypassPermissions

Run with cwd set to a fresh temp dir (`/tmp/bgspike-*`), so `bypassPermissions` could not touch project files. No `--bare`. Each stdin line is one JSON user message:

    {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}

Stdin stayed open for the whole run and was closed at about 180 s. Stdout was read on a thread and every line was timestamped (monotonic seconds since start) into `events-<variant>.jsonl` (git-ignored). Messages: msg1 at t=0 (start background work, reply `started` at once), msg2 `While that runs: what is 17 times 23?` at first `result` + 5 s, then no input until stdin was closed.

Runs (all quoted below; times are seconds since the start of the run):

| Run | Variant | msg1 asks for | File |
|---|---|---|---|
| A | `subagent` | a background subagent that runs `sleep 20` four times as four sequential foreground Bash calls, then replies `SUBAGENT-DONE` | `events-subagent.jsonl` |
| B | `bash` | Bash `run_in_background: true` with `sleep 90 && echo JOB-DONE` | `events-bash.jsonl` |
| C | `subagent-sleep90` | a background subagent running `sleep 90 && echo JOB-DONE` (first attempt) | `events-subagent-sleep90.jsonl` (from the earlier version of the script) |

Run C was not a clean test: Claude Code rejected the subagent's foreground `sleep 90` ("Blocked: sleep 90 followed by ... use run_in_background"), so the subagent returned at about 11 s after launching a nested background Bash task. Run A replaces it as the subagent evidence: the work really lasts about 84 s inside the subagent. Run C is kept only for the "subagent is re-woken" observation under (b).

## Answers

### (a) Did msg2 get its `result` before the job finished? Yes, in all three runs.

- Run A: msg2 sent at 10.6; answered at 11.54 (`17 × 23 = 391. The background subagent is still running.`); `result` at 12.91. The subagent finished at 87.9. msg2 was served while the subagent was busy, with no queueing.
- Run B: msg2 sent at 9.9, `result` at 12.8; the Bash job completed at 92.7.
- Run C: msg2 sent at 12.3, answered at 15.8, `result` at 17.0; JOB-DONE at 102.4. A `result` at 14.3 belonged to an auto-started turn (see below), not to msg2, so `result` events are not one to one with user messages.

### (b) Which event signals completion, and does it start a turn by itself? `system`/`task_notification`, and yes, it starts a new turn.

Run A, the end of the subagent's work (no user message was sent after msg2):

    87.15  user (agent_id=addfdf28..)  tool_result of the 4th Bash: "(Bash completed with no output)"
    87.83  assistant text: "SUBAGENT-DONE"                          <- the subagent's last output
    87.90  {"type":"system","subtype":"task_updated","task_id":"addfdf28f1ea954ad","patch":{"status":"completed", ...}}
    87.90  {"type":"system","subtype":"task_notification","task_id":"addfdf28f1ea954ad","tool_use_id":"toolu_01BPb3gW...","status":"completed",
            "output_file":"/tmp/.../tasks/addfdf28f1ea954ad.output","summary":"SUBAGENT-DONE","summary_is_report":true,"usage":{"total_tokens":40398,"tool_uses":4, ...}}
    87.90  {"type":"system","subtype":"background_tasks_changed","tasks":[]}
    88.98  assistant text (new turn, no user input): "The background subagent has finished. It ran `sleep 20` four times in sequence, using four Bash calls, and replied `SUBAGENT-DONE`."
    90.69  {"type":"result","subtype":"success", ...}

So the subagent's `task_notification` arrived 0.07 s after its final text and about 84 s after launch (3.24), and it began a turn on its own about 1 s later; that turn's `result` came at 90.7 s.

How the subagent was identified. Launch, at 3.24:

    {"type":"system","subtype":"task_started","task_id":"addfdf28f1ea954ad","tool_use_id":"toolu_01BPb3gW...","description":"Run four sleeps sequentially","subagent_type":"general-purpose","is_backgrounded":true,"spawn_depth":1,"task_type":"local_agent", ...}
    {"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"addfdf28f1ea954ad","task_type":"local_agent","subagent_type":"general-purpose","description":"Run four sleeps sequentially"}]}

Nested Bash calls inside the subagent also produce `task_started`/`task_notification` events, but of a different kind. Each of the four sleeps, for example the first, at 7.23 and 24.23:

    {"type":"system","subtype":"task_started","task_id":"be6wpk8t6","owned_by_subagent":true,"description":"sleep 20","is_backgrounded":false,"parent_task_id":"addfdf28f1ea954ad","task_type":"local_bash"}
    {"type":"system","subtype":"task_notification","task_id":"be6wpk8t6","status":"completed","output_file":"","summary":"sleep 20"}

Those inner notifications (24.2, 45.5, 66.3, 87.1) did NOT start a turn: the only `result` events are at 5.6, 12.9 and 90.7. The agent-level notification differs: `task_id` matches a `task_started` with `task_type":"local_agent"`, a non-empty `output_file`, and `"summary_is_report":true`. A host must filter on that, or it will treat every nested Bash call as a finished job.

Run B (Bash `run_in_background`), 92.7: `{"type":"system","subtype":"task_notification","task_id":"bygb6cpif", "status":"completed","output_file":"/tmp/...", ...}`, then `background_tasks_changed` with `tasks:[]`, an assistant turn, and `result` at 95.4 with no user message.

Run C (sleep90 subagent, blocked variant), in the local file `events-subagent-sleep90.jsonl`: the subagent `a65d70c8b95d924f2` was launched at 5.11 (`"task_type":"local_agent","is_backgrounded":true`), launched a nested background Bash task `bdnyvl68k` (9.87, `"task_type":"local_bash","parent_task_id":"a65d70c8..."`), and returned at 11.29 (`task_notification`, `status":"completed"`), which started an auto turn (assistant text at 14.28, `result` 14.3). When the nested Bash task finished at 99.88 (`task_notification` for `bdnyvl68k`), the same `task_id` was started again (`{"type":"system","subtype":"task_started","task_id":"a65d70c8b95d924f2","run_id":"0mwv2bx57-e9f4f1a4","task_type":"local_agent", ...}` at 99.91; the earlier launch had `run_id":"0mwv29vzn-8707c1c2"`), it read the output (`JOB-DONE` at 102.4), and a second `task_notification` for it came at 103.81. So a completed subagent can be re-woken under the same `task_id` with a new `run_id`, when a background job it started finishes later. This was seen once, in the distorted run.

The notification carries a status and a short summary (the subagent's report in run A), not the real data; the output file holds it.

### (c) Does the process stay alive and stdin stay accepted with background work running and no turn active? Yes.

In every run the process was alive at each check (msg1, msg2, t=120 s, t=180 s) and exited with code 0 about 1 s after stdin was closed. In run A there was no active turn from 12.9 to 87.9 while the subagent worked; msg2 itself was accepted during the work, and the idle period between 90.7 and 180 s was also safe. `result` ends a turn; it does not mean the process is done.

## Event type frequency

Run A (subagent, 3 `result`s for 2 user messages):

    9 assistant | 5 system/task_started | 5 user | 5 system/task_notification | 4 system/task_progress | 3 system/init | 3 system/post_turn_summary | 3 result/success | 2 system/background_tasks_changed | 2 system/task_summary | 1 system/hook_started | 1 system/hook_response | 1 system/commands_changed | 1 rate_limit_event | 1 system/task_updated

Run B (bash, 3 `result`s for 2 user messages):

    4 assistant | 3 system/init | 3 system/post_turn_summary | 3 result/success | 2 system/task_summary | 2 system/background_tasks_changed | 1 system/hook_started | 1 system/hook_response | 1 rate_limit_event | 1 system/task_started | 1 user | 1 system/commands_changed | 1 system/task_updated | 1 system/task_notification

Notes: a `system/init` event is emitted at the start of every turn, not once per session. A `result` arrives per turn, and turns can be started by the process itself, so `result` events need not match user messages. `result` events carry cumulative `total_cost_usd` (about 0.13 to 0.40 per process across runs; large because the owner's skills and hooks load into context).

## Conclusion and recommendation

What the evidence supports, no more: in headless stream-json mode with a long-running background subagent (run A, about 84 s of real work, no blocked commands), the process (1) answered a new user message while the subagent worked, (2) kept running and accepting stdin with no turn active, and (3) emitted a `system/task_notification` for the subagent itself, with `status":"completed"`, right when its work ended, followed by an automatic new assistant turn and a `result`, without any user message. The Bash `run_in_background` case behaves the same way (run B). So **recommendation (i): rely on the coordinator's own background jobs**, which is enough for spec goal 8 as far as this test goes. Option (ii) (a separate `claude -p` per job) is not shown to be needed, but it is not ruled out for harder cases.

Host rules that follow:

1. Treat a `task_notification` as a job completion only when its `task_id` was announced by a `task_started` with `task_type":"local_agent"` (or by a top-level background Bash, `local_bash` without `parent_task_id`). Ignore notifications for `owned_by_subagent`/`parent_task_id` tasks (they do not start turns).
2. `background_tasks_changed.tasks` is the live list of running jobs; an empty list means nothing is running.
3. The turn started by a notification is normal; do not map `result` to user messages one to one.
4. Keep stdin open for the life of the coordinator. Do not read the job's data from the notification; read `output_file`.

Not tested (limits): one run per variant; one job at a time (no concurrent subagents); jobs of at most about 90 s; no process restart or `--resume`; a message sent in the same instant a notification turn starts (run C hints it is queued and answered after the active turn); and a subagent re-woken under the same `task_id` (seen once, only in run C). Foreground `sleep N` with large N is blocked by Claude Code in this environment, so a coordinator asked for long waits will route them to background tasks.
