/**
 * A small Jellyfin API client: just the calls the Stream Deck controls need.
 *
 * There's no Stream Deck code in here on purpose. Keeping "talk to Jellyfin" separate from
 * "react to the hardware" means this file can be tested on its own against a fake server
 * (see test/mock-jellyfin.test.mjs), and the action files stay short.
 *
 * API used (all relative to your server, e.g. http://192.168.1.20:8096):
 *   GET  /Sessions?activeWithinSeconds=N         players the server has heard from recently
 *   GET  /Users                                  every user (admin key)
 *   GET  /Items/{id}?userId=...                  an item's audio and subtitle tracks
 *   GET  /Items/{id}/Images/Primary              artwork for the Now Playing key
 *   POST /Sessions/{id}/Command                  { Name, Arguments } e.g. SetVolume, MoveUp
 *   POST /Sessions/{id}/Command/{name}           commands with no arguments, e.g. ToggleMute
 *   POST /Sessions/{id}/Playing/{command}        PlayPause, Stop, NextTrack, PreviousTrack, Seek
 */

const TICKS_PER_SECOND = 10_000_000; // Jellyfin measures time in 100-nanosecond "ticks"

/** What the controls need to know about the player they're driving. */
export type Player = {
	id: string;
	deviceId: string;
	userId: string;
	/** Friendly name for the touch strip, e.g. "Jellyfin Media Player" or "Chrome". */
	name: string;
	/** 0-100, or null if the player hasn't reported a volume yet. */
	volume: number | null;
	muted: boolean;
	paused: boolean;
	playing: boolean;
	canSetVolume: boolean;
	canStepVolume: boolean;
	/** Play/pause, stop, next, previous and seek all need this. */
	canPlayPause: boolean;
	/** General commands the player accepts (MoveUp, SetSubtitleStreamIndex, ...). */
	commands: string[];
	item: NowPlaying | null;
};

export type NowPlaying = {
	id: string;
	/** "Episode name" for films, "S1E3 · Episode name" for episodes, "Artist · Track" for music. */
	title: string;
	/** Item whose artwork suits a square key: the series poster for an episode. */
	artworkId: string;
	positionSeconds: number;
	durationSeconds: number | null;
	audioIndex: number | null;
	subtitleIndex: number | null;
	/** When the position above was reported, so the controls can estimate the current time. */
	reportedAt: number;
};

/** Something in a user's Continue Watching or Next Up list. */
export type LibraryItem = {
	id: string;
	/** The film's name, or the series name for an episode. */
	name: string;
	/** "S2E4" for an episode, "" for a film. */
	episode: string;
	/** Where they stopped, in seconds (0 for Next Up). */
	positionSeconds: number;
	/** How much they've watched, 0-100. */
	percent: number;
};

export type LibraryList = "resume" | "nextup";

export type Track = { index: number; label: string };
export type Tracks = { audio: Track[]; subtitles: Track[] };

/** One connected player, as listed in the settings panel's dropdown. */
export type SessionSummary = {
	id: string;
	/** Stable across reconnects (the session Id isn't), so it's what we save when you pin a player. */
	deviceId: string;
	/** e.g. "Jellyfin Media Player · DESKTOP-PC · Alex (playing)". */
	label: string;
	canVolume: boolean;
};

export type JellyfinUser = { id: string; name: string };

/**
 * Which users get priority. An admin API key sees (and can control) every user's players,
 * so without this a control can grab someone else's TV.
 */
export type UserPriority = {
	/** User IDs whose players come first. Empty = no preference. */
	users?: string[];
	/** If true, other users' players are never controlled. */
	onlyUsers?: boolean;
};

/** Errors are sorted into kinds so the touch strip can say something useful. */
export type JellyfinErrorKind = "unreachable" | "unauthorized" | "http";

export class JellyfinError extends Error {
	constructor(
		readonly kind: JellyfinErrorKind,
		message: string,
	) {
		super(message);
	}
}

/** The parts of Jellyfin's session object that we read. */
export type RawSession = {
	Id: string;
	DeviceId?: string;
	UserId?: string;
	UserName?: string;
	Client?: string;
	DeviceName?: string;
	LastActivityDate?: string;
	SupportsMediaControl?: boolean;
	SupportedCommands?: string[];
	NowPlayingItem?: {
		Id?: string;
		Name?: string;
		Type?: string;
		SeriesId?: string;
		IndexNumber?: number;
		ParentIndexNumber?: number;
		RunTimeTicks?: number;
		Artists?: string[];
		AlbumArtist?: string;
	} | null;
	PlayState?: {
		VolumeLevel?: number | null;
		IsMuted?: boolean;
		IsPaused?: boolean;
		PositionTicks?: number;
		AudioStreamIndex?: number | null;
		SubtitleStreamIndex?: number | null;
	} | null;
};

/**
 * Sessions the server hasn't heard from in this long are ignored. Jellyfin keeps sessions
 * around after a tab closes or a device sleeps.
 */
const ACTIVE_WITHIN_SECONDS = 3600;

/** Jellyfin writes the same ID with or without dashes in different places. */
const normId = (id?: string) => (id ?? "").replace(/-/g, "").toLowerCase();

const canVolume = (s: RawSession) => {
	const cmds = s.SupportedCommands ?? [];
	return cmds.includes("SetVolume") || cmds.includes("VolumeUp");
};

/**
 * What a control needs from a player. The volume dial needs remote volume; everything else
 * needs remote control of playback or the menus.
 */
export type Need = "volume" | "control";
const meets = (s: RawSession, need: Need) => (need === "volume" ? canVolume(s) : canVolume(s) || !!s.SupportsMediaControl);

/** 2 = playing, 1 = paused, 0 = nothing loaded. Used to rank players in automatic mode. */
const activity = (s: RawSession) => (s.NowPlayingItem ? (s.PlayState?.IsPaused ? 1 : 2) : 0);

/**
 * A browser reports Client "Jellyfin Web" and DeviceName "Chrome"; an app reports its own
 * name as Client and the computer's name as DeviceName. Show whichever says more.
 */
const displayName = (s: RawSession) =>
	s.Client && !/web/i.test(s.Client) ? s.Client : s.DeviceName || s.Client || "Player";

function nowPlaying(s: RawSession, reportedAt: number): NowPlaying | null {
	const it = s.NowPlayingItem;
	if (!it?.Id) return null;
	let title = it.Name ?? "";
	if (it.Type === "Episode" && it.IndexNumber != null) {
		const season = it.ParentIndexNumber != null ? `S${it.ParentIndexNumber}` : "";
		title = `${season}E${it.IndexNumber} · ${title}`;
	} else if (it.Type === "Audio" && (it.AlbumArtist || it.Artists?.[0])) {
		title = `${it.AlbumArtist || it.Artists?.[0]} · ${title}`;
	}
	const ps = s.PlayState ?? {};
	return {
		id: it.Id,
		title,
		artworkId: it.Type === "Episode" && it.SeriesId ? it.SeriesId : it.Id,
		positionSeconds: (ps.PositionTicks ?? 0) / TICKS_PER_SECOND,
		durationSeconds: it.RunTimeTicks ? it.RunTimeTicks / TICKS_PER_SECOND : null,
		audioIndex: ps.AudioStreamIndex ?? null,
		subtitleIndex: ps.SubtitleStreamIndex ?? null,
		reportedAt,
	};
}

/** Turn Jellyfin's session object into what the controls use. */
export function toPlayer(s: RawSession, reportedAt = Date.now()): Player {
	const cmds = s.SupportedCommands ?? [];
	const level = s.PlayState?.VolumeLevel;
	return {
		id: s.Id,
		deviceId: s.DeviceId ?? "",
		userId: s.UserId ?? "",
		name: displayName(s),
		volume: typeof level === "number" ? level : null,
		muted: !!s.PlayState?.IsMuted,
		paused: !!s.PlayState?.IsPaused,
		playing: !!s.NowPlayingItem,
		canSetVolume: cmds.includes("SetVolume"),
		canStepVolume: cmds.includes("VolumeUp") && cmds.includes("VolumeDown"),
		canPlayPause: !!s.SupportsMediaControl,
		commands: cmds,
		item: nowPlaying(s, reportedAt),
	};
}

/**
 * Choose which session a control should drive.
 *
 * Priority users' players come before everyone else's, whatever they're doing: your own
 * paused app beats someone else's playing TV. Then playing beats paused beats idle, then
 * the most recently active. Pinning a player (deviceId) overrides all of this.
 */
export function pickSession(
	sessions: RawSession[],
	deviceId = "",
	priority: UserPriority = {},
	need: Need = "control",
): RawSession | null {
	const preferred = new Set((priority.users ?? []).map(normId));
	const isPreferred = (s: RawSession) => preferred.has(normId(s.UserId));

	const candidates = sessions
		.filter((s) => meets(s, need))
		.filter((s) => (deviceId ? s.DeviceId === deviceId : true))
		.filter((s) => deviceId || !priority.onlyUsers || preferred.size === 0 || isPreferred(s))
		.sort(
			(a, b) =>
				Number(isPreferred(b)) - Number(isPreferred(a)) ||
				activity(b) - activity(a) ||
				Date.parse(b.LastActivityDate ?? "0") - Date.parse(a.LastActivityDate ?? "0"),
		);
	return candidates[0] ?? null;
}

type RawItem = {
	Id: string;
	Name?: string;
	Type?: string;
	SeriesName?: string;
	IndexNumber?: number;
	ParentIndexNumber?: number;
	UserData?: { PlaybackPositionTicks?: number; PlayedPercentage?: number };
};

function toLibraryItem(it: RawItem): LibraryItem {
	const isEpisode = it.Type === "Episode";
	const episode =
		isEpisode && it.IndexNumber != null ? `${it.ParentIndexNumber != null ? `S${it.ParentIndexNumber}` : ""}E${it.IndexNumber}` : "";
	return {
		id: it.Id,
		name: (isEpisode && it.SeriesName) || it.Name || "Untitled",
		episode,
		positionSeconds: (it.UserData?.PlaybackPositionTicks ?? 0) / TICKS_PER_SECOND,
		percent: Math.round(it.UserData?.PlayedPercentage ?? 0),
	};
}

/** Short, readable name for an audio or subtitle track. */
function trackLabel(stream: { DisplayTitle?: string; Title?: string; Language?: string; IsForced?: boolean }): string {
	const base = stream.Title || stream.DisplayTitle?.split(" - ")[0] || stream.Language || "Track";
	return stream.IsForced ? `${base} (forced)` : base;
}

export class JellyfinClient {
	private readonly baseUrl: string;

	constructor(
		serverUrl: string,
		private readonly apiKey: string,
		private readonly timeoutMs = 4000,
	) {
		// Accept "192.168.1.20:8096" or "http://.../" and normalise to "http://192.168.1.20:8096".
		let url = serverUrl.trim().replace(/\/+$/, "");
		if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
		this.baseUrl = url;
	}

	/** Sessions the server has heard from in the last hour. */
	async getSessions(): Promise<RawSession[]> {
		return (await this.request("GET", `/Sessions?activeWithinSeconds=${ACTIVE_WITHIN_SECONDS}`)) as RawSession[];
	}

	/**
	 * Every recently active session, for the settings dropdowns. Players that can't take
	 * remote volume are marked, so you can see they're connected but limited.
	 */
	async listSessions(sessions?: RawSession[]): Promise<SessionSummary[]> {
		const list = sessions ?? (await this.getSessions());
		return list
			.filter((s) => s.DeviceId)
			.sort((a, b) => Number(canVolume(b)) - Number(canVolume(a)) || activity(b) - activity(a))
			.map((s) => {
				const status = !canVolume(s) ? " (no remote volume)" : ["", " (paused)", " (playing)"][activity(s)];
				const name = displayName(s);
				const device = s.DeviceName && s.DeviceName !== name ? ` · ${s.DeviceName}` : "";
				const user = s.UserName ? ` · ${s.UserName}` : "";
				return { id: s.Id, deviceId: s.DeviceId!, label: `${name}${device}${user}${status}`, canVolume: canVolume(s) };
			});
	}

	/** Every user on the server (needs an admin key, which API keys are). */
	async listUsers(): Promise<JellyfinUser[]> {
		const users = (await this.request("GET", "/Users")) as { Id: string; Name: string }[];
		return users.map((u) => ({ id: u.Id, name: u.Name })).sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Find the player to control (see pickSession for the rules). */
	async findPlayer(deviceId = "", priority: UserPriority = {}, need: Need = "volume"): Promise<Player | null> {
		const s = pickSession(await this.getSessions(), deviceId, priority, need);
		return s ? toPlayer(s) : null;
	}

	// ----- volume ---------------------------------------------------------------------

	/** Set an exact volume. Jellyfin wants the argument as a string. */
	setVolume(sessionId: string, volume: number): Promise<unknown> {
		const v = Math.max(0, Math.min(100, Math.round(volume)));
		return this.command(sessionId, "SetVolume", { Volume: String(v) });
	}

	/** Nudge the volume by the player's own step, for players without SetVolume. */
	stepVolume(sessionId: string, up: boolean): Promise<unknown> {
		return this.command(sessionId, up ? "VolumeUp" : "VolumeDown");
	}

	toggleMute(sessionId: string): Promise<unknown> {
		return this.command(sessionId, "ToggleMute");
	}

	// ----- playback -------------------------------------------------------------------

	playPause(sessionId: string): Promise<unknown> {
		return this.playing(sessionId, "PlayPause");
	}

	/** Playback commands: PlayPause, Stop, NextTrack, PreviousTrack. */
	playing(sessionId: string, name: "PlayPause" | "Stop" | "NextTrack" | "PreviousTrack"): Promise<unknown> {
		return this.request("POST", `/Sessions/${encodeURIComponent(sessionId)}/Playing/${name}`);
	}

	/** Jump to a position, in seconds from the start. */
	seek(sessionId: string, seconds: number): Promise<unknown> {
		const ticks = Math.max(0, Math.round(seconds * TICKS_PER_SECOND));
		return this.request("POST", `/Sessions/${encodeURIComponent(sessionId)}/Playing/Seek?seekPositionTicks=${ticks}`);
	}

	setSubtitleTrack(sessionId: string, index: number): Promise<unknown> {
		return this.command(sessionId, "SetSubtitleStreamIndex", { Index: String(index) });
	}

	setAudioTrack(sessionId: string, index: number): Promise<unknown> {
		return this.command(sessionId, "SetAudioStreamIndex", { Index: String(index) });
	}

	/**
	 * A "general command": volume, tracks and the remote-control ones (MoveUp, MoveDown,
	 * MoveLeft, MoveRight, Select, Back, GoHome, ToggleContextMenu, ToggleOsd, ToggleFullscreen).
	 */
	command(sessionId: string, name: string, args?: Record<string, string>): Promise<unknown> {
		const path = `/Sessions/${encodeURIComponent(sessionId)}/Command`;
		return args ? this.request("POST", path, { Name: name, Arguments: args }) : this.request("POST", `${path}/${name}`);
	}

	/**
	 * Tell a player to start something. The start position is sent explicitly, so it resumes
	 * exactly where the Continue Watching list says, whichever app is on the other end.
	 */
	play(sessionId: string, itemId: string, startSeconds = 0): Promise<unknown> {
		const ticks = Math.max(0, Math.round(startSeconds * TICKS_PER_SECOND));
		const query = `playCommand=PlayNow&itemIds=${encodeURIComponent(itemId)}&startPositionTicks=${ticks}`;
		return this.request("POST", `/Sessions/${encodeURIComponent(sessionId)}/Playing?${query}`);
	}

	// ----- the user's lists -----------------------------------------------------------

	/**
	 * A user's lists, most recent first.
	 *   resume: Continue Watching (films and episodes you stopped part way through).
	 *   nextup: the next unwatched episode of each show you're following.
	 * Continue Watching moved to /UserItems/Resume in newer servers; older ones use
	 * /Users/{userId}/Items/Resume, so we try the new address first.
	 */
	async getList(userId: string, list: LibraryList, limit = 20): Promise<LibraryItem[]> {
		const u = encodeURIComponent(userId);
		let result: { Items?: RawItem[] };
		if (list === "nextup") {
			result = (await this.request("GET", `/Shows/NextUp?userId=${u}&limit=${limit}`)) as { Items?: RawItem[] };
		} else {
			try {
				result = (await this.request("GET", `/UserItems/Resume?userId=${u}&limit=${limit}&mediaTypes=Video`)) as { Items?: RawItem[] };
			} catch (err) {
				if (!(err instanceof JellyfinError) || err.kind !== "http") throw err;
				result = (await this.request("GET", `/Users/${u}/Items/Resume?limit=${limit}&mediaTypes=Video`)) as { Items?: RawItem[] };
			}
		}
		return (result.Items ?? []).map(toLibraryItem);
	}

	// ----- item details ---------------------------------------------------------------

	/**
	 * The audio and subtitle tracks of what's playing. "Off" (index -1) is added to subtitles.
	 * Newer servers use /Items/{id}?userId=; older ones only have /Users/{userId}/Items/{id}.
	 */
	async getTracks(itemId: string, userId: string): Promise<Tracks> {
		type Stream = { Type?: string; Index: number; DisplayTitle?: string; Title?: string; Language?: string; IsForced?: boolean };
		type Item = { MediaStreams?: Stream[]; MediaSources?: { MediaStreams?: Stream[] }[] };
		let item: Item;
		try {
			item = (await this.request("GET", `/Items/${itemId}?userId=${userId}`)) as Item;
		} catch (err) {
			if (!(err instanceof JellyfinError) || err.kind !== "http") throw err;
			item = (await this.request("GET", `/Users/${userId}/Items/${itemId}`)) as Item;
		}
		const streams = item.MediaSources?.[0]?.MediaStreams ?? item.MediaStreams ?? [];
		const of = (type: string) => streams.filter((s) => s.Type === type).map((s) => ({ index: s.Index, label: trackLabel(s) }));
		return { audio: of("Audio"), subtitles: [{ index: -1, label: "Off" }, ...of("Subtitle")] };
	}

	/** Square artwork for a key, as a data URL Stream Deck can display directly. */
	async getArtwork(itemId: string, size = 144): Promise<string | null> {
		const path = `/Items/${itemId}/Images/Primary?fillWidth=${size}&fillHeight=${size}&quality=90`;
		const res = await this.send("GET", path);
		if (res.status === 404) return null; // no artwork
		if (!res.ok) throw new JellyfinError("http", `GET ${path} failed: ${res.status}`);
		const type = res.headers.get("content-type") ?? "image/jpeg";
		const bytes = Buffer.from(await res.arrayBuffer());
		return `data:${type};base64,${bytes.toString("base64")}`;
	}

	// ----- plumbing -------------------------------------------------------------------

	/**
	 * One place for every HTTP call, so auth, timeouts and errors live together.
	 *
	 * Auth uses the "Authorization: MediaBrowser Token=..." header. The older ways
	 * (X-Emby-Token, ?api_key=) are deprecated and switched off by default from Jellyfin 12.
	 */
	private async send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				method,
				headers: {
					Authorization: `MediaBrowser Token="${this.apiKey}"`,
					...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			if (res.status === 401 || res.status === 403) {
				throw new JellyfinError("unauthorized", `Jellyfin rejected the API key (${res.status})`);
			}
			return res;
		} catch (err) {
			if (err instanceof JellyfinError) throw err;
			throw new JellyfinError("unreachable", `Can't reach ${this.baseUrl}: ${(err as Error).message}`);
		}
	}

	private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
		const res = await this.send(method, path, body);
		if (!res.ok) throw new JellyfinError("http", `${method} ${path} failed: ${res.status} ${res.statusText}`);
		// Commands answer "204 No Content"; only GETs return JSON.
		const text = await res.text();
		return text ? JSON.parse(text) : null;
	}
}
