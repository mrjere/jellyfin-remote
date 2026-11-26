import { action, KeyAction, KeyDownEvent } from "@elgato/streamdeck";

import { hub } from "../hub";
import { BaseSettings, canPlayback, Instance, JellyfinAction } from "./base";

type Settings = BaseSettings;
type State = { shownImage?: string; shownTitle?: string; paused?: { value: boolean; until: number } };

/**
 * Shows the poster of whatever's playing (the series poster for an episode). Press: play / pause.
 * Leave the key's icon as the default in Stream Deck, or the artwork can't be shown.
 */
@action({ UUID: "com.jere.jellyfin-remote.nowplaying" })
export class NowPlayingKey extends JellyfinAction<Settings> {
	protected readonly need = "control" as const;

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const { player } = this.resolve(inst);
		if (await this.run(inst, canPlayback, (c, p) => c.playPause(p.id))) {
			(inst.state as State).paused = { value: !player?.paused, until: Date.now() + 3000 };
			await this.render(inst);
		}
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const key = inst.action as KeyAction<Settings>;
		const st = inst.state as State;
		const { player } = this.resolve(inst);
		const item = player?.item;

		let image: string | undefined; // undefined = the default icon from the manifest
		if (item && hub.client) {
			try {
				image = (await hub.artworkFor(item.artworkId)) ?? undefined;
			} catch {
				image = undefined;
			}
		}
		const paused = st.paused && Date.now() < st.paused.until ? st.paused.value : !!player?.paused;
		const title = item && paused ? "Paused" : "";

		// The hub redraws every couple of seconds; only send the image when it actually changes.
		const imageKey = image ?? "default";
		if (imageKey !== st.shownImage) {
			await key.setImage(image);
			st.shownImage = imageKey;
		}
		if (title !== st.shownTitle) {
			await key.setTitle(title);
			st.shownTitle = title;
		}
	}
}
