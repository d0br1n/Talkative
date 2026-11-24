import { join } from "node:path";
import { AccessToken } from "livekit-server-sdk";
import { clearCode, writeCode, type Config } from "../config";
import { runService } from "../lifecycle";
import { LinkServer } from "./link-server";
import { loadOrCreateKeys } from "./livekit";
import { Pairing } from "./pairing";
import { Room } from "./room";
import { SpeechWorker } from "./speech";
import { VoiceConversation } from "./conversation";

/** The exit code for "the room is gone"; systemd's Restart=on-failure brings the service back. */
export const EXIT_ROOM_LOST = 75;

/** Start everything the voice side needs and run until a signal or a lost room. Resolves to the exit code. */
export function runVoice(config: Config): Promise<number> {
  return runService(async (cleanup, lost) => {
    const v = config.voice;
    clearCode(); // never leave a stale code readable while starting
    cleanup.add("code file", () => clearCode());
    const keys = loadOrCreateKeys();
    const worker = new SpeechWorker({
      python: v.python, stt: v.stt, tts: v.tts, memoryMaxMb: v.memoryMaxMb, cwd: join(import.meta.dir, "..", ".."),
    });
    cleanup.add("speech worker", () => worker.stop());
    const link = new LinkServer({ host: v.bind, port: v.linkPort, secret: config.linkSecret });
    cleanup.add("link server", () => link.stop());
    const pairing = new Pairing({
      bind: v.bind, port: v.pairPort, apiKey: keys.apiKey, apiSecret: keys.apiSecret, livekitUrl: v.livekitUrl, room: v.room,
      onCode: writeCode,
    });
    cleanup.add("pairing server", () => pairing.stop());
    const mint = async () => {
      const t = new AccessToken(keys.apiKey, keys.apiSecret, { identity: `voice-${Date.now().toString(36)}`, ttl: "1h" });
      t.addGrant({ roomJoin: true, room: v.room, canPublish: true, canSubscribe: true, canPublishData: true });
      return t.toJwt();
    };
    const room = new Room({ url: v.livekitUrl, token: mint });
    cleanup.add("room", () => room.close());

    const conversation = new VoiceConversation({
      stt: worker, tts: worker, speaker: room.speaker, phone: room.phone, agent: link, verbosity: v.verbosity,
      approvalTimeoutMs: /^\d+$/.test(process.env.TALKATIVE_APPROVAL_TIMEOUT_MS ?? "") ? Number(process.env.TALKATIVE_APPROVAL_TIMEOUT_MS) : undefined,
    });
    link.onMessage((m) => conversation.onAgent(m));
    link.onConnection((up) => conversation.onAgentConnection(up));
    room.onFrame((f) => conversation.onFrame(f));
    room.onPhone((m) => conversation.onPhone(m));
    room.onPhoneJoined(() => conversation.onPhoneJoined());
    room.onPhoneGone(() => conversation.onPhoneGone());
    room.onLost(() => {
      console.error("voice: lost the livekit room; exiting for a restart");
      lost(EXIT_ROOM_LOST);
    });

    await link.start();
    await pairing.start(); // writes the code file through onCode
    await worker.start();
    await room.join();
    console.log(`voice: ready. pairing code: ${pairing.code}`);
    console.log(`voice: pair at http://${v.bind}:${pairing.port}/pair, link on ws://${v.bind}:${link.port}`);
  });
}
