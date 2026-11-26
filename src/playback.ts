/**
 * Small, pure helpers for time and tracks, shared by the dials and the remote button.
 * "Pure" means no network and no Stream Deck: same input, same output. That's what makes
 * them easy to test (see test/playback.test.mjs).
 */
import type { NowPlaying, Track } from "./jellyfin";

/**
 * Where playback is right now. Players only report their position every few seconds, so
 * between reports we add the time that has passed (unless paused).
 */
export function estimatePosition(item: NowPlaying, paused: boolean, now = Date.now()): number {
	const elapsed = paused ? 0 : (now - item.reportedAt) / 1000;
	const pos = item.positionSeconds + Math.max(0, elapsed);
	return item.durationSeconds ? Math.min(pos, item.durationSeconds) : pos;
}

/** Keep a seek target inside the item. */
export function clampPosition(seconds: number, item: NowPlaying): number {
	const max = item.durationSeconds ?? Number.POSITIVE_INFINITY;
	return Math.max(0, Math.min(seconds, max));
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Step through a list of tracks, wrapping round at either end.
 * @param current The index Jellyfin uses for the current track (-1 = subtitles off).
 * @param steps How many tracks to move; negative goes backwards.
 */
export function stepTrack(tracks: Track[], current: number | null, steps: number): Track | null {
	if (tracks.length === 0) return null;
	const at = Math.max(0, tracks.findIndex((t) => t.index === current));
	const next = (((at + steps) % tracks.length) + tracks.length) % tracks.length;
	return tracks[next];
}

export function trackLabel(tracks: Track[], index: number | null): string {
	return tracks.find((t) => t.index === index)?.label ?? (index === -1 || index === null ? "Off" : `Track ${index}`);
}

/** What a Resume button should do, given what the player is doing. */
export type ResumeDecision =
	| { kind: "unpause" } // something's loaded and paused: carry on
	| { kind: "none" } // something's already playing: leave it alone
	| { kind: "play"; itemId: string; startSeconds: number } // stopped: start the top of Continue Watching
	| { kind: "empty" }; // stopped, and nothing to continue

export function decideResume(
	player: { item: unknown; paused: boolean },
	continueWatching: { id: string; positionSeconds: number }[],
): ResumeDecision {
	if (player.item) return player.paused ? { kind: "unpause" } : { kind: "none" };
	const top = continueWatching[0];
	return top ? { kind: "play", itemId: top.id, startSeconds: top.positionSeconds } : { kind: "empty" };
}

/**
 * Which way the Navigate dial moves. A plain turn moves along your chosen axis; turning while
 * holding the dial down moves along the other one. Clockwise is right / down.
 */
export function navigateCommand(ticks: number, pressed: boolean, axis: "horizontal" | "vertical" = "horizontal"): string {
	const vertical = (axis === "vertical") !== pressed; // holding the dial swaps the axis
	const forward = ticks > 0;
	return vertical ? (forward ? "MoveDown" : "MoveUp") : forward ? "MoveRight" : "MoveLeft";
}
