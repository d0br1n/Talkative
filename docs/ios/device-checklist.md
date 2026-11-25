# Device checklist

Checks to run on a real iPhone, with the Talkative app installed through SideStore (see
[install.md](install.md)). The design behind them is in section 9 of
[the iOS app design](../specs/2026-11-25-ios-app-design.md).

No results are recorded yet. Fill in each `Result:` line, with the date, the iPhone model, the iOS
version and the earbuds you used. Write what happened, not just pass or fail.

Before you start:

- The voice side and the agent are running (`bun src/main.ts voice`, `bun src/main.ts agent`).
- Tailscale is up on the phone and on the voice side.
- In another terminal, run `tail -f ~/.talkative/phone.log`. You need it for check 13.

Run the checks in order. Some depend on the phone being paired.

## The eight checks from the design

### 1. Pair

Do: Open the app, enter the voice side's Tailscale IP in `pair › voice side` and the code in
`pair › code`, tap `[ connect ]`, and allow the microphone.

Expect: The pairing screen goes away and the main screen shows the connection coming up. Say
something and the agent answers.

Result:

### 2. Talk with the screen locked

Do: Start a conversation, put earbuds in, and lock the phone. Ask a question that takes the agent a
little while to answer. Keep talking for at least 5 minutes, with the phone locked the whole time.

Expect: The conversation keeps going. You hear replies and the agent hears you. The app does not
drop out when the screen goes dark. Unlock the phone and the transcript matches what was said.

Result:

### 3. Switch AirPods in and out

Do: During a conversation, take the earbuds out, talk to the phone's speaker and mic, then put them
back in. Also try switching to another Bluetooth output and back, if you have one.

Expect: Audio moves to the new route without a restart. The conversation keeps going, and the
voice does not stay silent after the switch.

Result:

### 4. Take a phone call mid-conversation

Do: While talking, call the iPhone from another phone and answer. Talk, hang up, and wait.

Expect: The conversation pauses for the call. After you hang up, it comes back without you opening
the app, or with one tap if it does not. Note which one happened.

Result:

### 5. Cross from Wi-Fi to cellular

Do: Start a conversation on Wi-Fi. Turn Wi-Fi off, or walk out of range, so the phone moves to
cellular. Then turn Wi-Fi on again.

Expect: The app shows that it is waiting while the network changes, reconnects on its own, and
you can keep talking. You do not need to open Options or pair again.

Result:

### 6. Approve from the panel

Do: Ask the agent to do something that needs approval. An `┌─ approval needed` panel shows up with
`[ approve ]`, `[ deny ]` and a 30-minute countdown. Tap `[ approve ]`. Then ask for another and
tap `[ deny ]`.

Expect: Approving lets the agent go on. Denying makes it stop that action and say so. The panel
goes away after you choose.

Result:

### 7. Press an AirPods stem to stop

Do: While the voice is speaking a long reply, press the stem on your AirPods. This is iOS 17
press-to-mute, and it only works on AirPods that support it. If yours do not, write that down and
use `[ stop ]` on the main screen instead.

Expect: The voice stops. The agent is not interrupted and keeps working. You can then speak or
type as normal.

Result:

### 8. The 7-day SideStore refresh

Do: Leave the app installed for a week. After about 6 days, open SideStore and look at the days
left on Talkative. Refresh it (or let SideStore do it), then repeat check 2 for a minute or two.

Expect: The app opens after the refresh and still keeps audio running with the screen locked. This
is not known in advance: whether background audio survives re-signing is only found out here.

Result:

## Added checks

### 9. Approvals survive locking the phone for 5 minutes

Do: Get an approval panel on screen, lock the phone, and wait 5 minutes. Unlock it.

Expect: The panel is still there, the countdown has run down by about 5 minutes, and `[ approve ]`
still works.

Result:

### 10. Reduce Motion freezes the mark

Do: Open Settings, then Accessibility, then Motion, and turn on Reduce Motion. Return to
Talkative while the agent is working or speaking.

Expect: The mark on the main screen stays still. Turn Reduce Motion off and it moves again.

Result:

### 11. Light mode looks like the printout

Do: Set the iPhone to light appearance. Open the main screen, Options and the pairing screen.
Compare them with the light-mode design in the printout.

Expect: The screens match the printout: colours, text, and the `[ ... ]` buttons. Text is readable.
Note any screen that is off.

Result:

### 12. The options work

Do: Open Options (the gear). Change verbosity, model and effort, and turn the voice audio and
microphone switches off and on. Try `[ new conversation ]`, then `[ leave ]` and `[ rejoin ]`.

Expect: Each change takes effect: the agent's replies change with verbosity, silence follows the
audio switch, and nothing is heard from you while the microphone is off. A new conversation starts
fresh. Leave and rejoin work without pairing again.

Result:

### 13. The phone log receives the app's connection lines

Do: With `tail -f ~/.talkative/phone.log` running on the voice side, open the app, pair or
reconnect, and then turn the Wi-Fi off and on (check 5).

Expect: Lines appear in the form `<UTC time> <info|error> <text>`, covering the connection and the
reconnect. Copy a few of them below.

Result:

## Failures

For each check that fails, write it up as a follow-up: the check number, what you did, what
happened, and the matching lines from `~/.talkative/phone.log` if there are any.
