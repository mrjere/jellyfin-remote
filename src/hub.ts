/**
 * The hub: shared state for every Jellyfin control on the deck.
 *
 * Without it, ten controls would each poll the server every few seconds. Instead the hub
 * polls once, keeps the latest list of sessions, and tells every visible control to redraw.
 * It also holds the settings shared by all controls (server, API key, default player and
 * priority users), which Stream Deck stores as the plugin's "global settings".
 */
import streamDeck from "@elgato/streamdeck";

import {
	JellyfinClient,
	JellyfinError,
	LibraryItem,
	LibraryList,
	Need,
	pickSession,
	Player,
	RawSession,
	toPlayer,
	Tracks,
} from "./jellyfin";

const LIST_TTL_MS = 30_000; // Continue Watching doesn't change often; re-fetch at most every 30s

/** Saved once for the whole plugin (the `global` fields in the settings pages). */
export type GlobalSettings = {
	serverUrl?: string;
	apiKey?: string;
	/** Player every control uses unless it picks its own. Empty = automatic. */
	defaultDeviceId?: string;
	/** User IDs whose players come first in automatic mode. */
	users?: string[];
	/** Never control other users' players in automatic mode. */
	onlyUsers?: boolean;
};

export type Status = "setup" | "ok" | "noPlayer" | "offline" | "badKey" | "error";

export const STATUS_TEXT: Record<Exclude<Status, "ok">, string> = {
	setup: "Set up",
	noPlayer: "No player",
	offline: "Offline",
	badKey: "Bad key",
	error: "Error",
};

export function statusFor(err: unknown): Status {
	if (!(err instanceof JellyfinError)) return "error";
	return err.kind === "unauthorized" ? "badKey" : err.kind === "unreachable" ? "offline" : "error";
}

const POLL_MS = 2000; // how often to ask the server what's playing, while any control is visible
const log = streamDeck.logger.createScope("Hub");

class Hub {
	global: GlobalSettings = {};
	client: JellyfinClient | null = null;

	private sessions: RawSession[] = [];
	private fetchedAt = 0;
	private status: Status = "setup";
	private inflight: Promise<void> | null = null;
	private readonly listeners = new Set<() => void>();
	private pollTimer?: ReturnType<typeof setInterval>;
	private soonTimer?: ReturnType<typeof setTimeout>;
	private readonly tracks = new Map<string, Promise<Tracks>>();
	private readonly artwork = new Map<string, Promise<string | null>>();
	private readonly lists = new Map<string, { at: number; items: Promise<LibraryItem[]> }>();

	private markReady!: () => void;
	/** Resolves once the global settings have been loaded at startup. */
	readonly ready = new Promise<void>((resolve) => (this.markReady = resolve));

	/** Called at startup and whenever a settings page changes a shared setting. */
	setGlobal(settings: GlobalSettings): void {
		this.global = settings ?? {};
		const { serverUrl, apiKey } = this.global;
		this.client = serverUrl?.trim() && apiKey?.trim() ? new JellyfinClient(serverUrl, apiKey.trim()) : null;
		this.tracks.clear();
		this.artwork.clear();
		this.lists.clear();
		this.markReady();
		void this.refresh();
	}

	/** A control asks to be told when anything changes. Returns a function that stops it. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		if (!this.pollTimer) this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				clearInterval(this.pollTimer);
				this.pollTimer = undefined;
			}
		};
	}

	/** Fetch sessions now. Calls made while a fetch is running share that fetch. */
	refresh(): Promise<void> {
		if (this.inflight) return this.inflight;
		this.inflight = (async () => {
			if (!this.client) {
				this.sessions = [];
				this.status = "setup";
				return;
			}
			try {
				this.sessions = await this.client.getSessions();
				this.fetchedAt = Date.now();
				this.status = "ok";
			} catch (err) {
				this.sessions = [];
				this.status = statusFor(err);
				log.warn((err as Error).message);
			}
		})().finally(() => {
			this.inflight = null;
			for (const listener of this.listeners) listener();
		});
		return this.inflight;
	}

	/** After sending a command, check back shortly so the deck shows the result. */
	refreshSoon(ms = 500): void {
		clearTimeout(this.soonTimer);
		this.soonTimer = setTimeout(() => void this.refresh(), ms);
	}

	/**
	 * The player a control should drive: its own pick, else the shared default player,
	 * else automatic (priority users first, then whatever's playing).
	 */
	resolve(deviceId: string | undefined, need: Need): { player: Player | null; status: Status } {
		if (this.status !== "ok") return { player: null, status: this.status };
		const target = deviceId || this.global.defaultDeviceId || "";
		const priority = { users: this.global.users, onlyUsers: this.global.onlyUsers };
		const session = pickSession(this.sessions, target, priority, need);
		return session ? { player: toPlayer(session, this.fetchedAt), status: "ok" } : { player: null, status: "noPlayer" };
	}

	/** The latest sessions, for the settings dropdowns. */
	get latestSessions(): RawSession[] {
		return this.sessions;
	}

	/** Audio and subtitle tracks of an item, fetched once and remembered. */
	tracksFor(itemId: string, userId: string): Promise<Tracks> {
		return this.cached(this.tracks, itemId, () => this.client!.getTracks(itemId, userId));
	}

	/** Artwork for the Now Playing key, fetched once and remembered. */
	artworkFor(itemId: string): Promise<string | null> {
		return this.cached(this.artwork, itemId, () => this.client!.getArtwork(itemId));
	}

	/** A user's Continue Watching or Next Up list, remembered for 30 seconds. */
	listFor(userId: string, list: LibraryList, fresh = false): Promise<LibraryItem[]> {
		const key = `${userId}:${list}`;
		const hit = this.lists.get(key);
		if (hit && !fresh && Date.now() - hit.at < LIST_TTL_MS) return hit.items;
		const items = this.client!.getList(userId, list);
		items.catch(() => this.lists.delete(key));
		this.lists.set(key, { at: Date.now(), items });
		return items;
	}

	/** After starting something, the lists change (it moves to the top), so forget them. */
	forgetLists(): void {
		this.lists.clear();
	}

	private cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
		let value = map.get(key);
		if (!value) {
			value = load();
			value.catch(() => map.delete(key)); // don't remember failures, try again next time
			map.set(key, value);
			if (map.size > 40) map.delete(map.keys().next().value!); // keep the cache small
		}
		return value;
	}
}

export const hub = new Hub();
