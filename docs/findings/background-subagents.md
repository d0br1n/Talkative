# Background subagents under headless stream-json

Spike: `spikes/background-jobs/check.py` (Python, standard library). Date 2026-11-24, `claude` 2.1.329, model `sonnet`, owner's normal login.

## Setup (exact)

    claude -p --input-format stream-json --output-format stream-json --verbose \
      --model sonnet --permission-mode bypassPermissions

Run with cwd set to a fresh temp dir (`/tmp/bgspike-*`), so `bypassPermissions` could not touch project files. No `--bare`. Each stdin line is one JSON user message:

    {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}

Stdin stayed open for the whole run and was closed at about 180 s. Stdout was read on a thread and every line was timestamped (monotonic seconds since start). Messages: msg1 at t=0 (start a background job that runs `sleep 90 && echo JOB-DONE`), msg2 `While that runs: what is 17 times 23?` at first `result` + 5 s, then no input until stdin was closed.

Two runs: `subagent` (msg1 asks for a background subagent, as the brief says) and `bash` (msg1 asks for Bash `run_in_background: true`). The bash run was done for comparison even though (b) was not "nothing".

Caveat: in the subagent run the subagent's foreground `sleep 90 && echo JOB-DONE` was rejected by Claude Code ("Blocked: sleep 90 followed by ... use run_in_background"), so the subagent re-ran it as a background Bash task and finished early. The result is still a real signal, but it contains two nested background tasks (the subagent, then its Bash task), and the subagent was re-woken when the Bash task finished.

## Answers

### (a) Did msg2 get its `result` before JOB-DONE appeared? Yes, in both runs.

Subagent run: msg2 sent at 12.3 s, its answer (`17 × 23 = 391.`) came at 15.8 s and its `result` at 17.0 s. JOB-DONE first appeared in the stream at 102.4 s. Note that a `result` at 14.3 s did not belong to msg2: it closed an auto-started turn (the subagent had completed early and been reported) that was already running when msg2 arrived; msg2 was queued and handled as the next turn. Hosts must therefore not assume one `result` per user message in order.

Bash run: msg2 sent at 9.8 s, answered at 10.6 s ("17 × 23 = 391. The background job is still running."), `result` at 11.6 s. Job finished at 92.7 s.

### (b) Which event signals completion, and does it start a turn by itself? `system`/`task_notification`, and yes, it starts a new turn.

No user message was sent, yet after the job finished the stream emitted this, then the model produced a new assistant turn and a `result`.

Bash run (92.67 s):

    {"type":"system","subtype":"task_notification","task_id":"b9eaqiqlp","tool_use_id":"toolu_011Z...","status":"completed","output_file":"/tmp/.../tasks/b9eaqiqlp.output","summary":"Background command \"Sleep 90s then print done\" completed (exit code 0)"}
    {"type":"system","subtype":"background_tasks_changed","tasks":[]}                      (92.67 s)
    {"type":"assistant", ... "text":"The background job finished with exit code 0, so `JOB-DONE` should be in its output file. ..."}   (93.71 s)
    {"type":"system","subtype":"post_turn_summary", ...}  then  {"type":"result","subtype":"success", ...}   (96.56 s)

Subagent run: `task_notification` for the Bash task at 99.88 s (`status":"completed"`, `parent_task_id` = the subagent), the subagent was re-started (`task_started` with the same `task_id` a65d70c8b95d924f2, 99.91 s), it read the output file (JOB-DONE at 102.4 s), a second `task_notification` for the subagent itself at 103.81 s (summary contains the verbatim `JOB-DONE`), an assistant text turn at 105.77 s, and a `result` at 107.44 s. The first subagent `task_notification` (11.29 s) fired when the subagent returned early, and it also started an assistant turn (reported at 14.28 s) with no user input.

Related events: `background_tasks_changed` (full list of running tasks, empty list = nothing running), `task_started`, `task_progress`, `task_updated` (`patch.status` = `completed`), `task_summary`. For subagents `task_started` carries `"task_type":"local_agent","is_backgrounded":true`; for Bash `"task_type":"local_bash"`.

The notification carries a status and a summary, but the job's real output is not in the event. The model has to read `output_file`, and for the Bash run it did not (it said it did not open the file). The host should not treat `task_notification` as proof of a correct result.

### (c) Does the process stay alive and stdin stay accepted with a background job running and no turn active? Yes.

In both runs the process was alive at every check (`alive=True` at msg1, msg2, t=120 s and t=180 s) and exited with code 0 about 1 s after stdin was closed. The idle gap between the end of a turn (17.0 s / 11.6 s) and job completion (about 100 s / 92.7 s) held no active turn; msg2 itself was accepted by stdin while the job was running (msg2 was sent after the first `result` while the job was still pending). Between 107 s and 180 s there was no turn and no background job, and the process still stayed alive until stdin was closed. The `result` event does not mean the process is finished; it only ends a turn.

## Event type frequency

Subagent run (4 `result`s for 2 user messages):

    13 assistant | 6 system/background_tasks_changed | 4 system/init | 4 user (tool results) | 4 system/post_turn_summary | 4 result/success
    3 task_started | 3 task_progress | 3 task_updated | 3 task_notification | 2 commands_changed | 2 task_summary | 2 thinking_tokens
    1 hook_started | 1 hook_response | 1 rate_limit_event

Bash run (3 `result`s for 2 user messages):

    4 assistant | 3 system/init | 3 post_turn_summary | 3 result/success | 2 task_summary | 2 background_tasks_changed
    1 task_started | 1 task_updated | 1 task_notification | 1 user | 1 commands_changed | 1 hook_started | 1 hook_response | 1 rate_limit_event

Notes: a `system`/`init` event is emitted at the start of every turn (not only once per session). A `result` event arrives per turn, and turns can be started by the process itself (background-task notification), so there can be more `result` events than user messages. `result` events include `total_cost_usd` (cumulative per process: about 0.36 USD at the end of the subagent run, 0.13 at the end of the bash run; large because the owner's session context, skills and hooks are loaded).

## Recommendation: (i) rely on the coordinator's own background jobs

The coordinator can start background work, keeps answering new messages while it runs, and the stream signals completion on its own with a new turn. The host should:

1. Watch `system`/`task_notification` (fields `task_id`, `status`, `summary`, `output_file`; `parent_task_id`/subagent info is in the matching `task_started`) as the "background job finished" signal, and `system`/`background_tasks_changed` (`tasks` list) as the live set of running jobs.
2. Treat the process-started turn that follows as a normal turn, and the next `result` as its end. Do not map `result` events one to one to user messages: a user message sent while an auto-turn is active is queued and answered after it.
3. Keep stdin open for the life of the coordinator; do not infer "done" from a `result`.
4. Not rely on the notification's content for the job's output; the coordinator reads the output file.

Fallback (ii) (a separate `claude -p` per job) is not needed for goal 8 based on this evidence. Limits of the evidence: one run per variant, short (90 s) jobs, one concurrent job, and the subagent run was distorted by the harness's foreground-sleep block (see the caveat above). Concurrent jobs, very long jobs and process restarts were not tested.
