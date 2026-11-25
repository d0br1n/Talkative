# Installing the Talkative iPhone app

The app is not signed and is not on the App Store. You install it with SideStore, which signs it
with your own free Apple ID. It needs iOS 17 or later.

## What a free Apple ID allows

- An app signed with a free Apple ID expires after 7 days. SideStore re-signs it before then (see
  "Keeping it alive" below). If it expires, the app will not open until you refresh it.
- You can have 3 sideloaded apps at a time.
- You can create 10 App IDs a week. Each new app you sign uses one. Re-signing the same app does not.

## 1. Install SideStore

Follow SideStore's own instructions at <https://sidestore.io>. They change, so they are not copied
here. You need a computer once, to set it up, and Tailscale is not involved yet.

## 2. Get the app

Pick one.

**From the source (easier to update).** In SideStore, open Sources, tap `+`, and add:

    https://github.com/d0br1n/Talkative/releases/latest/download/source.json

Then open Talkative in the source and tap Get. The link follows the latest release, so a new
release shows up as an update.

**From the `.ipa` file.** Download `Talkative.ipa` from the
[latest release](https://github.com/d0br1n/Talkative/releases/latest), save it in Files on the
iPhone, then in SideStore tap `+` on My Apps and choose the file.

There is no release until the owner tags one (`v*`). Until then there is nothing to install.

## 3. Keeping it alive

SideStore refreshes apps on its own when it can run in the background, and you can refresh by hand
from My Apps. Check it once a few days in: open My Apps and look at the days left on Talkative.
Whether a refresh leaves background audio working is not known until the device check
(item 8 in [device-checklist.md](device-checklist.md)).

## 4. Start the voice side

On the laptop or server that runs Talkative, with Tailscale up:

    bun src/main.ts voice

It prints `voice: ready. pairing code: ...` when it is ready. To read the code again later:

    bun src/main.ts code

Setting up the voice side from a clean clone is in [deploy/README.md](../../deploy/README.md).
Both the phone and the voice side must be on the same tailnet.

## 5. Pair the phone

1. Open Talkative. The first screen is the pairing screen.
2. In `pair › voice side`, enter the voice side's Tailscale IP, which `tailscale ip -4` prints on
   that machine. If the pairing port is not the default 7890, add it as `host:port`.
3. In `pair › code`, enter the three-word code.
4. Tap `[ connect ]`.
5. iOS asks for microphone access. Allow it.

The code changes after every successful pair and each time `voice` starts, so read it again before
you pair a second phone. Five wrong codes lock pairing for 60 seconds.

The phone keeps its pairing for 30 days. To pair again, or to pair with a different voice side,
open Options (the gear) and tap `[ unpair this phone ]`.

## If it does not connect

Read the phone's own log on the voice side:

    tail -f ~/.talkative/phone.log

The app sends its connection lines there. More in the Phone log section of
[deploy/README.md](../../deploy/README.md).
