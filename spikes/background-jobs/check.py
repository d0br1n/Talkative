#!/usr/bin/env python3
"""Spike: can a headless stream-json Claude Code process run background work
while still answering new user messages, and does the stream signal completion?

Records every stdout line with a monotonic timestamp into events.jsonl (overwritten per run).
Usage: python3 spikes/background-jobs/check.py [--variant subagent|bash]
"""
import argparse, json, os, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
MSG1 = {
    "subagent": "Start a background subagent that runs `sleep 90 && echo JOB-DONE` with Bash and reports its output. Don't wait for it; reply 'started' immediately.",
    "bash": "Run `sleep 90 && echo JOB-DONE` with the Bash tool using run_in_background: true. Don't wait for it; reply 'started' immediately.",
}
MSG2 = "While that runs: what is 17 times 23?"


def user_line(text):
    return json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}}) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=["subagent", "bash"], default="subagent")
    args = ap.parse_args()
    out_path = os.path.join(HERE, "events.jsonl")
    cwd = tempfile.mkdtemp(prefix="bgspike-")
    cmd = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json",
           "--verbose", "--model", "sonnet", "--permission-mode", "bypassPermissions"]
    print("cmd:", " ".join(cmd), "\ncwd:", cwd, "\nvariant:", args.variant, flush=True)
    t0 = time.monotonic()
    now = lambda: time.monotonic() - t0
    proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1)
    lock = threading.Lock()
    state = {"results": [], "first_result": threading.Event()}
    out = open(out_path, "w")

    def log(rec):
        with lock:
            out.write(json.dumps(rec) + "\n"); out.flush()

    def reader():
        for line in proc.stdout:
            t = now()
            try:
                ev = json.loads(line)
            except Exception:
                ev = {"unparsed": line.rstrip()}
            log({"t": round(t, 2), "event": ev})
            if ev.get("type") == "result":
                state["results"].append(t)
                print(f"[{t:6.1f}s] result event #{len(state['results'])}", flush=True)
                state["first_result"].set()
            s = json.dumps(ev)
            if "JOB-DONE" in s and ev.get("type") != "assistant" or (ev.get("type") == "user" and "JOB-DONE" in s):
                print(f"[{t:6.1f}s] JOB-DONE seen in {ev.get('type')}/{ev.get('subtype')}", flush=True)
    def err_reader():
        for line in proc.stderr:
            log({"t": round(now(), 2), "stderr": line.rstrip()})
    threading.Thread(target=reader, daemon=True).start()
    threading.Thread(target=err_reader, daemon=True).start()

    def send(label, text):
        t = now()
        proc.stdin.write(user_line(text)); proc.stdin.flush()
        log({"t": round(t, 2), "sent": label, "text": text, "alive": proc.poll() is None})
        print(f"[{t:6.1f}s] sent {label}; alive={proc.poll() is None}", flush=True)

    send("msg1", MSG1[args.variant])
    if not state["first_result"].wait(120):
        print("no result within 120s"); 
    t_send1 = 0.0
    time.sleep(5)
    send("msg2", MSG2)
    # idle until t = 120s after msg1, then read up to 60s more
    deadline = t_send1 + 120
    while now() < deadline and proc.poll() is None:
        time.sleep(1)
    print(f"[{now():6.1f}s] idle point reached; alive={proc.poll() is None}", flush=True)
    end = now() + 60
    while now() < end and proc.poll() is None:
        time.sleep(1)
    alive_at_end = proc.poll() is None
    print(f"[{now():6.1f}s] closing stdin; alive={alive_at_end}", flush=True)
    log({"t": round(now(), 2), "closing_stdin": True, "alive": alive_at_end})
    try:
        proc.stdin.close()
    except Exception:
        pass
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill(); print("killed after timeout")
    log({"t": round(now(), 2), "exit_code": proc.returncode})
    print(f"[{now():6.1f}s] exit code {proc.returncode}; results at {[round(x,1) for x in state['results']]}")
    out.close()


if __name__ == "__main__":
    main()
