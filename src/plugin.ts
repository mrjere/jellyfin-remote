import streamDeck from "@elgato/streamdeck";

import { LibraryDial } from "./actions/library-dial";
import { NavigateDial } from "./actions/navigate-dial";
import { NowPlayingKey } from "./actions/now-playing-key";
import { RemoteKey } from "./actions/remote-key";
import { ScrubDial } from "./actions/scrub-dial";
import { TracksDial } from "./actions/tracks-dial";
import { VolumeDial } from "./actions/volume-dial";
import { sendPanelList } from "./actions/base";
import { GlobalSettings, hub } from "./hub";

// "info" rather than "trace": trace logs every message between Stream Deck and the plugin,
// including settings, so your API key would end up in the log files.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new VolumeDial());
streamDeck.actions.registerAction(new ScrubDial());
streamDeck.actions.registerAction(new TracksDial());
streamDeck.actions.registerAction(new NavigateDial());
streamDeck.actions.registerAction(new LibraryDial());
streamDeck.actions.registerAction(new NowPlayingKey());
streamDeck.actions.registerAction(new RemoteKey());

// Shared settings changed in a settings page: update the hub and refresh any open lists.
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(async (ev) => {
	hub.setGlobal(ev.settings);
	for (const list of ["getPlayers", "getDefaultPlayers", "getUsers"]) await sendPanelList(list);
});

await streamDeck.connect();
hub.setGlobal(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
