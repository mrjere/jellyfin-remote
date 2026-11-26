/**
 * What every Jellyfin control has in common, so each action file only describes what makes
 * it different: which player it needs, what to draw, and what its buttons do.
 */
import streamDeck, {
	DialAction,
	DidReceiveSettingsEvent,
	KeyAction,
	SendToPluginEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub, Status, statusFor } from "../hub";
import { JellyfinClient, Need, Player } from "../jellyfin";

export type BaseSettings = JsonObject & {
	/** This control's own player (DeviceId). Empty = use the shared default. */
	deviceId?: string;
	// Settings from v1.x, when server and key were stored per dial. Moved to global on first run.
	serverUrl?: string;
	apiKey?: string;
	users?: string[];
	onlyUsers?: boolean;
};

/** One visible instance of a control (you could have the same action on several keys). */
export type Instance<S extends BaseSettings> = {
	action: KeyAction<S> | DialAction<S>;
	settings: S;
	stop: () => void;
	/** Per-instance working state, e.g. a volume level you've just dialled in. */
	state: Record<string, unknown>;
};

const log = streamDeck.logger.createScope("Controls");

export abstract class JellyfinAction<S extends BaseSettings> extends SingletonAction<S> {
	/** Whether this control needs a player with remote volume, or just remote control. */
	protected abstract readonly need: Need;
	protected readonly instances = new Map<string, Instance<S>>();

	/** Draw the key image or touch strip for one instance. Called whenever anything changes. */
	protected abstract render(instance: Instance<S>): Promise<void>;

	override async onWillAppear(ev: WillAppearEvent<S>): Promise<void> {
		await hub.ready;
		await migrateOldSettings(ev.payload.settings);
		const instance: Instance<S> = { action: ev.action as KeyAction<S> | DialAction<S>, settings: ev.payload.settings, stop: () => {}, state: {} };
		instance.stop = hub.subscribe(() => void this.safeRender(instance));
		this.instances.set(ev.action.id, instance);
		await this.safeRender(instance);
	}

	override onWillDisappear(ev: WillDisappearEvent<S>): void {
		this.instances.get(ev.action.id)?.stop();
		this.instances.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): Promise<void> {
		const instance = this.instances.get(ev.action.id);
		if (!instance) return;
		instance.settings = ev.payload.settings;
		await this.safeRender(instance);
	}

	/** The settings page's dropdowns and checklist ask for their contents here. */
	override async onSendToPlugin(ev: SendToPluginEvent<{ event?: string }, S>): Promise<void> {
		const event = ev.payload?.event;
		if (event) await sendPanelList(event);
	}

	/** The player this instance should drive right now (its own, the shared default, or automatic). */
	protected resolve(instance: Instance<S>): { player: Player | null; status: Status } {
		return hub.resolve(instance.settings.deviceId, this.need);
	}

	/**
	 * Run a command against this instance's player. If there's no player, or the player can't
	 * do it, the key shows Stream Deck's warning triangle instead of failing silently.
	 */
	protected async run(
		instance: Instance<S>,
		allowed: (player: Player) => boolean,
		command: (client: JellyfinClient, player: Player) => Promise<unknown>,
	): Promise<boolean> {
		const { player } = this.resolve(instance);
		if (!hub.client || !player || !allowed(player)) {
			await instance.action.showAlert();
			return false;
		}
		try {
			await command(hub.client, player);
			hub.refreshSoon();
			return true;
		} catch (err) {
			log.warn(`${this.manifestId ?? "action"}: ${(err as Error).message} (${statusFor(err)})`);
			await instance.action.showAlert();
			return false;
		}
	}

	private async safeRender(instance: Instance<S>): Promise<void> {
		try {
			await this.render(instance);
		} catch (err) {
			log.warn(`render failed: ${(err as Error).message}`);
		}
	}
}

/** Can this player take this general command (MoveUp, SetSubtitleStreamIndex, ...)? */
export const accepts = (name: string) => (p: Player) => p.commands.includes(name);
export const canPlayback = (p: Player) => p.canPlayPause;
export const hasItem = (p: Player) => p.canPlayPause && !!p.item;

/** Versions before 2.0 kept server and key on the volume dial. Move them to the shared settings once. */
async function migrateOldSettings(s: BaseSettings): Promise<void> {
	if (!s.serverUrl || !s.apiKey || hub.global.serverUrl) return;
	const global = {
		...hub.global,
		serverUrl: s.serverUrl,
		apiKey: s.apiKey,
		users: hub.global.users ?? s.users,
		onlyUsers: hub.global.onlyUsers ?? s.onlyUsers,
	};
	await streamDeck.settings.setGlobalSettings(global);
	hub.setGlobal(global);
	log.info("Moved server settings from the volume dial to the shared settings.");
}

type ListItem = { value: string; label: string; disabled?: boolean };

/**
 * Fill a settings-page list. Event names match the `datasource` attributes in the HTML:
 *   getPlayers         this control's player ("Shared default" first)
 *   getDefaultPlayers  the shared default player ("Automatic" first)
 *   getUsers           priority users checklist
 */
export async function sendPanelList(event: string): Promise<void> {
	let items: ListItem[];
	const client = hub.client;
	try {
		if (!client) {
			items = [{ value: "-", label: "Enter server and API key below", disabled: true }];
		} else if (event === "getUsers") {
			items = (await client.listUsers()).map((u) => ({ value: u.id, label: u.name }));
		} else if (event === "getPlayers" || event === "getDefaultPlayers") {
			await hub.refresh();
			const first =
				event === "getPlayers"
					? { value: "", label: "Shared default player" }
					: { value: "", label: "Automatic (priority users first)" };
			const sessions = await client.listSessions(hub.latestSessions);
			items = [first, ...sessions.map((s) => ({ value: s.deviceId, label: s.label }))];
		} else {
			return;
		}
	} catch (err) {
		items = [{ value: "-", label: `Can't load list: ${statusFor(err)}`, disabled: true }];
	}
	try {
		await streamDeck.ui.sendToPropertyInspector({ event, items });
	} catch {
		// No settings page open; nothing to update.
	}
}
