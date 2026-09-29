// On-screen photos from our storage, loaded a few at a time.
//
// A gallery <img loading="lazy"> starts its request the moment it comes near
// the screen and never cancels it, so scrolling the Database (1,000+ cards)
// requests every photo it passes — hundreds within seconds, which the photo
// server answers with 429 "too many requests". Here each card photo instead
// waits for a turn: at most MAX_IN_FLIGHT at once, spaced by the same pacer
// the print/export preloads use (so they back off together), and a photo that
// scrolls away before its turn is dropped from the queue instead of fetched.
// A refused photo waits a jittered, growing pause and queues again.

import { refused, served, takeTurn } from "./imageLoad";
import { PLACEHOLDER_IMG } from "../util";

/** Transparent 1×1 GIF shown until the photo's turn comes. */
export const BLANK_IMG =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const MAX_IN_FLIGHT = 6;
const MAX_TRIES = 5;
/** How far outside the screen a photo is still worth fetching. */
const NEAR = "600px 0px";
/** A request that hasn't answered in this long gives its slot back. */
const STALL_MS = 30_000;

interface Job {
  img: HTMLImageElement;
  src: string;
  tries: number;
  near: boolean;
  queued: boolean;
  /** Set while this photo holds a slot; frees the slot exactly once. */
  release?: () => void;
  /** Waiting out a backoff pause after a refusal. */
  cooling: boolean;
  timer?: number;
}

const jobs = new Map<HTMLImageElement, Job>();
const queue: Job[] = [];
let inFlight = 0;
/** Slots started but still waiting for their pacer turn. */
let waiting = 0;
let io: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const j = jobs.get(e.target as HTMLImageElement);
          if (!j) continue;
          j.near = e.isIntersecting;
          if (j.near) enqueue(j);
          else unqueue(j);
        }
        pump();
      },
      { rootMargin: NEAR }
    );
  }
  return io;
}

function enqueue(j: Job) {
  if (!j.queued && !j.release && !j.cooling) {
    j.queued = true;
    queue.push(j);
  }
}

function unqueue(j: Job) {
  if (!j.queued) return;
  j.queued = false;
  const i = queue.indexOf(j);
  if (i >= 0) queue.splice(i, 1);
}

function finish(j: Job) {
  unqueue(j);
  window.clearTimeout(j.timer);
  // A photo still loading when its card goes away (or gets another photo)
  // may never report back: the browser drops a request silently when the
  // <img> is pointed elsewhere. Free its slot now so the gate can't run dry.
  j.release?.();
  if (jobs.get(j.img) === j) {
    jobs.delete(j.img);
    io?.unobserve(j.img);
  }
}

function pump() {
  // Start a slot per free lane while anything is waiting. A slot picks its
  // photo only after its pacer turn comes, so a turn is never spent on a card
  // that scrolled away in the meantime; newest first, i.e. what is on screen now.
  while (inFlight < MAX_IN_FLIGHT && waiting < queue.length) {
    inFlight++;
    waiting++;
    void runSlot();
  }
}

async function runSlot() {
  await takeTurn();
  waiting--;
  const j = queue.pop();
  if (!j) {
    inFlight--;
    pump();
    return;
  }
  j.queued = false;
  const img = j.img;
  let stall = 0;
  const onLoad = () => done(true);
  const onErr = () => done(false);
  j.release = () => {
    j.release = undefined;
    img.removeEventListener("load", onLoad);
    img.removeEventListener("error", onErr);
    window.clearTimeout(stall);
    inFlight--;
    // Deferred: finish() can call this from inside a React cleanup.
    queueMicrotask(pump);
  };
  const done = (ok: boolean) => {
    if (!j.release) return;
    j.release();
    if (jobs.get(img) !== j) return;
    if (ok) {
      served();
      finish(j);
      return;
    }
    refused();
    j.tries++;
    if (j.tries >= MAX_TRIES) {
      img.src = PLACEHOLDER_IMG;
      finish(j);
      return;
    }
    // Show the card's plain background, not a broken-image icon, while this
    // photo waits. Jittered so a batch refused together doesn't return together.
    img.src = BLANK_IMG;
    j.cooling = true;
    const wait = Math.min(1000 * 2 ** (j.tries - 1), 10_000) * (0.5 + Math.random());
    j.timer = window.setTimeout(() => {
      j.cooling = false;
      if (j.near) enqueue(j);
      pump();
    }, wait);
  };
  img.addEventListener("load", onLoad);
  img.addEventListener("error", onErr);
  stall = window.setTimeout(() => done(false), STALL_MS);
  img.src = j.src;
}

/**
 * Load `src` into `img` when it's near the screen and a turn is free. Returns
 * the cleanup to call when the <img> unmounts or its photo changes.
 */
export function watchImage(img: HTMLImageElement, src: string): () => void {
  const old = jobs.get(img);
  if (old) finish(old);
  img.src = BLANK_IMG;
  const j: Job = { img, src, tries: 0, near: false, queued: false, cooling: false };
  jobs.set(img, j);
  observer().observe(img);
  return () => {
    if (jobs.get(img) === j) finish(j);
    pump();
  };
}
