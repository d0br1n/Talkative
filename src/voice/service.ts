import { rmSync } from "node:fs";
import { join } from "node:path";
import { ensureHome, writeSecretFile, type Config } from "../config";
import { LinkServer } from "./link-server";
import { loadOrCreateKeys } from "./livekit";
import { Pairing } from "./pairing";
import { Room } from "./room";
import { SpeechWorker } from "./speech";
import { VoiceConversation } from "./conversation";
import { AccessToken } from "livekit-server-sdk";

/** Start everything the voice side needs and run until a signal. */
export async function runVoice(config: Config): Promise<void> {
  const v = config.voice;
  const keys = loadOrCreateKeys();
  const worker = new SpeechWorker({
    python: v.python, stt: v.stt, tts: v.tts, memoryMaxMb: v.memoryMaxMb, cwd: join(import.meta.dir, "..", ".."),
  });
  const link = new LinkServer({ host: v.bind, port: v.linkPort, secret: config.linkSecret });
  const pairing = new Pairing({
    bind: v.bind, port: v.pairPort, apiKey: keys.apiKey, apiSecret: keys.apiSecret, livekitUrl: v.livekitUrl, room: v.room,
  });
  const token = new AccessToken(keys.apiKey, keys.apiSecret, { identity: `voice-${Date.now().toString(36)}`, ttl: "24h" });
  token.addGrant({ roomJoin: true, room: v.room, canPublish: true, canSubscribe: true, canPublishData: true });
  const room = new Room({ url: v.livekitUrl, token: await token.toJwt() });

  const conversation = new VoiceConversation({
    stt: worker, tts: worker, speaker: room.speaker, phone: room.phone, agent: link, verbosity: v.verbosity,
    approvalTimeoutMs: /^\d+$/.test(process.env.TALKATIVE_APPROVAL_TIMEOUT_MS ?? "") ? Number(process.env.TALKATIVE_APPROVAL_TIMEOUT_MS) : undefined,
  });
  link.onMessage((m) => conversation.onAgent(m));
  link.onConnection((up) => conversation.onAgentConnection(up));
  room.onFrame((f) => conversation.onFrame(f));
  room.onPhone((m) => conversation.onPhone(m));
  room.onPhoneGone(() => conversation.onPhoneGone());

  await link.start();
  await pairing.start();
  const dir = ensureHome();
  writeSecretFile(join(dir, "code"), `${pairing.code}\n`);
  await worker.start();
  await room.join();
  console.log(`voice: ready. pairing code: ${pairing.code}`);
  console.log(`voice: pair at http://${v.bind}:${pairing.port}/pair, link on ws://${v.bind}:${link.port}`);

  await new Promise<void>((resolve) => {
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => resolve());
  });
  rmSync(join(dir, "code"), { force: true });
  pairing.stop();
  link.stop();
  worker.stop();
  await room.close().catch(() => {});
}
