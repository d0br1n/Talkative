// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
import { randomInt, timingSafeEqual } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";

const WORDS = (
  "amber anchor apple arrow aspen atlas badger basil beacon birch bison bloom border breeze bridge bronze " +
  "cabin cactus candle canyon cedar chalk cherry cinder clover cobalt comet copper coral cove crane creek " +
  "crystal daisy dawn delta desert dune eagle ember falcon fern field finch fjord flint forest fox frost " +
  "garnet ginger glacier granite grove harbor hazel heron hill holly honey iris island ivory jade jasper " +
  "juniper kettle lagoon lantern larch lemon lilac linen lotus maple marble meadow mint mist moss nectar " +
  "oak oasis olive onyx orchid otter pebble pine plum pond poppy prairie quartz quill raven reef ridge " +
  "river robin saffron sage sand sierra silver slate sparrow spruce stone storm summit swan thistle thyme " +
  "tide timber topaz tulip valley velvet violet walnut willow wren yarrow zephyr"
).split(" ");

const TOKEN_TTL = "720h"; // 30 days
const MAX_BODY = 1024;
const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;
const LOCK_MS = 60_000;

export interface PairingOptions {
  bind: string;
  port: number;
  apiKey: string;
  apiSecret: string;
  livekitUrl: string;
  room: string;
  words?: string[];
  /** Test hook. */
  now?: () => number;
}

/** Hands the phone a long-lived room token in exchange for the three-word code shown on the server. */
export class Pairing {
  code = "";
  private server: ReturnType<typeof Bun.serve> | null = null;
  private failures: number[] = [];
  private lockedUntil = 0;
  private readonly now: () => number;

  constructor(private readonly o: PairingOptions) {
    this.now = o.now ?? Date.now;
  }

  get port(): number {
    return this.server?.port ?? this.o.port;
  }

  get hostname(): string {
    return this.server?.hostname ?? this.o.bind;
  }

  async start(): Promise<void> {
    this.stop();
    const words = this.o.words ?? WORDS;
    this.code = [0, 1, 2].map(() => words[randomInt(words.length)]).join(" ");
    this.failures = [];
    this.lockedUntil = 0;
    this.server = Bun.serve({
      hostname: this.o.bind,
      port: this.o.port,
      fetch: (req) => this.handle(req),
    });
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/pair") return new Response("not found", { status: 404 });
    const t = this.now();
    if (t < this.lockedUntil) return new Response("locked", { status: 429 });
    let given = "";
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("too large", { status: 413 });
    const text = await req.text();
    if (Buffer.byteLength(text) > MAX_BODY) return new Response("too large", { status: 413 });
    try {
      const body = JSON.parse(text) as { code?: unknown };
      if (typeof body.code === "string") given = body.code.trim().toLowerCase().replace(/\s+/g, " ");
    } catch {}
    const a = Buffer.from(given);
    const b = Buffer.from(this.code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.failures = this.failures.filter((f) => t - f < WINDOW_MS);
      this.failures.push(t);
      if (this.failures.length >= MAX_FAILURES) {
        this.lockedUntil = t + LOCK_MS;
        this.failures = [];
      }
      return new Response("wrong code", { status: 403 });
    }
    this.failures = [];
    const token = new AccessToken(this.o.apiKey, this.o.apiSecret, { identity: "phone", ttl: TOKEN_TTL });
    token.addGrant({
      roomJoin: true, room: this.o.room, canPublish: true, canSubscribe: true, canPublishData: true,
    });
    return Response.json({ url: this.o.livekitUrl, token: await token.toJwt() });
  }
}
