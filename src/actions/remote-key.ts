import { action, KeyAction, KeyDownEvent } from "@elgato/streamdeck";

import { hub } from "../hub";
import { JellyfinClient, Player } from "../jellyfin";
import { clampPosition, decideResume, estimatePosition, stepTrack } from "../playback";
import { accepts, BaseSettings, canPlayback, hasItem, Instance, JellyfinAction } from "./base";

type Settings = BaseSettings & { command?: string };
type State = { shownCommand?: string };

type Command = {
	/** Can the player do this? If not, the key shows a warning triangle. */
	allowed: (p: Player) => boolean;
	run: (c: JellyfinClient, p: Player) => Promise<unknown>;
};

const general = (name: string): Command => ({ allowed: accepts(name), run: (c, p) => c.command(p.id, name) });

const skip = (seconds: number): Command => ({
	allowed: hasItem,
	run: (c, p) => c.seek(p.id, clampPosition(estimatePosition(p.item!, p.paused) + seconds, p.item!)),
});

const cycleTrack = (kind: "subtitles" | "audio"): Command => ({
	allowed: accepts(kind === "subtitles" ? "SetSubtitleStreamIndex" : "SetAudioStreamIndex"),
	run: async (c, p) => {
		if (!p.item) throw new Error("Nothing playing");
		const tracks = await hub.tracksFor(p.item.id, p.userId);
		const list = tracks[kind];
		const current = kind === "subtitles" ? p.item.subtitleIndex ?? -1 : p.item.audioIndex;
		const next = stepTrack(list, current, 1);
		if (!next || list.length < 2) throw new Error(`No other ${kind} tracks`);
		return kind === "subtitles" ? c.setSubtitleTrack(p.id, next.index) : c.setAudioTrack(p.id, next.index);
	},
});

/**
 * Resume: carry on if paused, or after Stop, start the top of that user's Continue Watching
 * from where they left off. If something's already playing, it does nothing.
 */
const resume: Command = {
	allowed: (p) => p.canPlayPause && !!p.userId,
	run: async (c, p) => {
		const list = p.item ? [] : await hub.listFor(p.userId, "resume", true); // fresh: Stop just updated it
		const decision = decideResume(p, list);
		if (decision.kind === "unpause") return c.playPause(p.id);
		if (decision.kind === "play") {
			hub.forgetLists();
			return c.play(p.id, decision.itemId, decision.startSeconds);
		}
		if (decision.kind === "empty") throw new Error("Nothing in Continue Watching");
	},
};

/**
 * Every button the Remote action can be. The key name matches the dropdown in
 * ui/remote.html and the icon file in imgs/remote/.
 */
export const COMMANDS: Record<string, Command> = {
	playpause: { allowed: canPlayback, run: (c, p) => c.playPause(p.id) },
	stop: { allowed: canPlayback, run: (c, p) => c.playing(p.id, "Stop") },
	resume,
	next: { allowed: canPlayback, run: (c, p) => c.playing(p.id, "NextTrack") },
	previous: { allowed: canPlayback, run: (c, p) => c.playing(p.id, "PreviousTrack") },
	back10: skip(-10),
	forward30: skip(30),
	subtitles: cycleTrack("subtitles"),
	audio: cycleTrack("audio"),
	mute: general("ToggleMute"),
	up: general("MoveUp"),
	down: general("MoveDown"),
	left: general("MoveLeft"),
	right: general("MoveRight"),
	select: general("Select"),
	back: general("Back"),
	home: general("GoHome"),
	menu: general("ToggleContextMenu"),
	info: general("ToggleOsd"),
	fullscreen: general("ToggleFullscreen"),
};

/** One key, any remote button: pick which in its settings. The icon follows your choice. */
@action({ UUID: "com.jere.jellyfin-remote.remote" })
export class RemoteKey extends JellyfinAction<Settings> {
	protected readonly need = "control" as const;

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const cmd = COMMANDS[commandOf(inst)];
		await this.run(inst, cmd.allowed, cmd.run);
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const st = inst.state as State;
		const name = commandOf(inst);
		if (st.shownCommand === name) return; // only change the icon when you pick a different button
		await (inst.action as KeyAction<Settings>).setImage(`imgs/remote/${name}@2x.png`);
		st.shownCommand = name;
	}
}

function commandOf(inst: Instance<Settings>): string {
	const name = inst.settings.command ?? "playpause";
	return name in COMMANDS ? name : "playpause";
}
