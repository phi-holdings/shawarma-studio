// Load/handshake state machine for the song runtime iframe (no DOM here, so it is unit-testable).
//
// - Every load the parent starts gets a fresh random nonce (runtime.html?n=<nonce>). Only a HELLO
//   carrying the current nonce counts, and it uses the nonce up for HELLO.
// - When that HELLO and the parent's own load event are both in (either order), the port is handed
//   over (hooks.connect) and the state is "connecting": the document that got the port may still not
//   be ours (a navigation can land between HELLO and the load event). Only an ACK sent over the port
//   echoing the load's nonce, which only the real runtime knows (from its own URL; CONNECT never
//   carries it), makes the state "connected"; requests flow only then. No ACK within `ackMs`: reset
//   and reload with a new nonce (it counts as a failed attempt).
// - Once connected (or connecting), any further iframe load event means the document navigated:
//   reset and reload with a new nonce at once.
// - While loading, a load event must be followed by a valid HELLO within `graceMs`, and the whole
//   handshake must finish within the attempt's timeout; otherwise the frame is reloaded with a new
//   nonce, with growing timeouts, until the attempts run out: then give up.

export interface HandshakeHooks {
  /** Point the iframe at runtime.html?n=<nonce>. */
  navigate(nonce: string): void;
  /** Hand the frame's current document a MessagePort (CONNECT, without the nonce). */
  connect(): void;
  /** The ACK came: the port really leads to our runtime; requests may flow. */
  connected(): void;
  /** Drop the port and everything in flight (a reload follows). */
  reset(): void;
  /** No runtime after every retry. */
  giveUp(error: Error): void;
}

export interface HandshakeOptions {
  /** Wait for the handshake per attempt: the first load, then each retry. */
  timeoutsMs: number[];
  graceMs: number;
  ackMs: number;
  randomNonce(): string;
}

export const DEFAULT_HANDSHAKE: HandshakeOptions = {
  timeoutsMs: [20_000, 10_000, 20_000, 30_000],
  graceMs: 2000,
  ackMs: 2000,
  randomNonce: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''),
};

export type HandshakeState = 'loading' | 'connecting' | 'connected' | 'failed';

export class Handshake {
  state: HandshakeState = 'loading';
  /** Failed attempts since the last successful handshake. */
  attempt = 0;
  /** This load's nonce: HELLO may use it once; the ACK must echo it. */
  private loadNonce: string | null = null;
  private helloOk = false;
  /** The parent started a navigation whose load event has not arrived yet / it has arrived. */
  private ownLoadPending = false;
  private ownLoaded = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private grace: ReturnType<typeof setTimeout> | undefined;
  private readonly o: HandshakeOptions;

  constructor(private readonly hooks: HandshakeHooks, options: Partial<HandshakeOptions> = {}) {
    this.o = { ...DEFAULT_HANDSHAKE, ...options };
  }

  start() { this.attempt = 0; this.load(); }

  /** A HELLO from the frame's window: true when it carries this load's nonce (once). */
  hello(nonce: unknown): boolean {
    if (this.state !== 'loading' || this.helloOk || this.loadNonce === null || nonce !== this.loadNonce) return false;
    this.helloOk = true;
    this.maybeConnect();
    return true;
  }

  /** An ACK over the port: true (connected) only for this load's nonce while connecting. */
  ack(nonce: unknown): boolean {
    if (this.state !== 'connecting' || this.loadNonce === null || nonce !== this.loadNonce) return false;
    this.state = 'connected';
    this.loadNonce = null;
    this.attempt = 0;
    this.clear();
    this.hooks.connected();
    return true;
  }

  /** The iframe fired a load event. */
  loaded() {
    const own = this.ownLoadPending;
    this.ownLoadPending = false;
    if (this.state === 'connected') { this.restart(false); return; }   // the document navigated away
    if (this.state === 'connecting') { this.restart(true); return; }   // not the document we connected
    if (this.state !== 'loading') return;
    if (own) {
      this.ownLoaded = true;
      this.maybeConnect();
      if (this.state !== 'loading') return;
    }
    clearTimeout(this.grace);
    this.grace = setTimeout(() => this.retry(), this.o.graceMs);
  }

  /** The connected runtime stopped answering (a request timed out): reset and reload. */
  unresponsive() {
    if (this.state === 'connected' || this.state === 'connecting') this.restart(this.state === 'connecting');
  }

  dispose() { this.clear(); }

  private maybeConnect() {
    if (this.state !== 'loading' || !this.helloOk || !this.ownLoaded) return;
    this.state = 'connecting';
    this.clear();
    this.timer = setTimeout(() => this.restart(true), this.o.ackMs);
    this.hooks.connect();
  }

  /** Drop the connection and load again; `failed`: this counts as a failed attempt. */
  private restart(failed: boolean) {
    this.hooks.reset();
    if (!failed) { this.attempt = 0; this.load(); return; }
    this.state = 'loading';
    this.retry();
  }

  private load() {
    this.clear();
    this.state = 'loading';
    this.loadNonce = this.o.randomNonce();
    this.helloOk = false;
    this.ownLoaded = false;
    this.ownLoadPending = true;
    this.hooks.navigate(this.loadNonce);
    this.timer = setTimeout(() => this.retry(), this.o.timeoutsMs[Math.min(this.attempt, this.o.timeoutsMs.length - 1)]);
  }

  private retry() {
    if (this.state !== 'loading') return;
    if (this.attempt >= this.o.timeoutsMs.length - 1) {
      this.clear();
      this.loadNonce = null;
      this.state = 'failed';
      this.hooks.giveUp(new Error('The song runtime did not load (see the browser console); reload the page.'));
      return;
    }
    this.attempt++;
    this.load();
  }

  private clear() { clearTimeout(this.timer); clearTimeout(this.grace); }
}
