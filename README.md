# Jellyfin Remote for Stream Deck +

A free remote control for [Jellyfin](https://jellyfin.org) on the Elgato Stream Deck +. Use the
dials, keys and touch strip to control any player signed in to your Jellyfin server, such as the
app on your own PC while you play a game, or the TV in the living room from the sofa.

It uses Jellyfin's built-in remote control API, so there is nothing to install on the server.

## Features

- **Five dial controls** for volume, seeking, subtitles and audio tracks, menu navigation, and Continue
  Watching, each with a live readout on the touch strip
- **Now Playing key** that shows the poster of whatever is on
- **Remote button key** that can be set to any of 20 commands, from play/pause to fullscreen
- **Resume after Stop**: plays the top item in Continue Watching from where you left off
- **Browse and play** from Continue Watching or Next Up without picking up a remote
- **Control any player on the server**, including other users' sessions
- **Pin each control to its own player**, or have them all follow one shared default
- **Priority users**, so automatic player selection picks your own sessions first
- **One-time setup**: the server address and API key are entered once and shared by every control
- **Light on your server**: one shared poll, however many controls are on the deck

## Requirements

- A Stream Deck +. The two key controls also work on other Stream Deck models.
- Stream Deck app 7.1 or newer, on Windows 10+ or macOS 12+
- A Jellyfin server, and an administrator account to create an API key
- A Jellyfin client that accepts remote control. Most official Jellyfin apps do, but some don't
  support every command (see [Troubleshooting](#troubleshooting)).

## Installation

1. Download `com.jere.jellyfin-remote.streamDeckPlugin` from the
   [latest release](../../releases/latest).
2. Double-click the file. The Stream Deck app installs it and adds a **Jellyfin Remote**
   category to the actions list.

## Setup

1. In the Jellyfin dashboard, go to **API Keys** (under Advanced), add a new key and name it
   something like "Stream Deck".
2. Drag any Jellyfin Remote control onto your deck.
3. In its settings, under **Shared by every Jellyfin control**, enter your server address (for
   example `http://192.168.1.20:8096`) and the API key.

You only do this once. Every other Jellyfin Remote control you add uses the same details.

## Controls

### Dials

| Control | Turn | Press | Tap the strip | Hold the strip |
|---|---|---|---|---|
| **Volume** | Volume up / down | Play / pause | Mute | |
| **Seek** | Seek back / forward | Play / pause | Left half: back 10s. Right half: forward 30s | Stop |
| **Subtitles & audio** | Step through subtitles | Next audio track | Subtitles off / back on | Next audio track |
| **Navigate menus** | Left / right. Press and turn: up / down | OK | Back | Home |
| **Continue watching** | Choose an item | Play from where you left off | Switch between Continue Watching and Next Up | Play from the start |

On **Navigate menus**, a press only counts as OK if you let go without turning. This stops a
press-and-turn from selecting something by accident.

### Keys

**Now playing** shows the poster of what's playing (the series poster for an episode) and plays
or pauses when pressed. The artwork only appears while the key uses its default icon, so don't
set a custom icon on this one.

**Remote button** can be set to any of these:

| Playback | Tracks and sound | Menus |
|---|---|---|
| Play / pause | Next subtitles | Up, down, left, right |
| Stop | Next audio track | OK / select |
| Resume (continue watching) | Mute | Back |
| Next, previous | | Home |
| Back 10 seconds | | Menu |
| Forward 30 seconds | | Info (on-screen display) |
| | | Fullscreen |

**Resume** carries on if the player is paused. If playback was stopped, it plays the top item in
that user's Continue Watching from where they left off.

### Per-control settings

| Control | Setting |
|---|---|
| Volume | Step per click, 1 to 10% (default 5) |
| Seek | Step per click: 5 seconds, 10 seconds, 30 seconds or 1 minute (default 10 seconds) |
| Navigate menus | Turning moves left/right or up/down (pressing and turning gives the other) |
| Continue watching | Starts on Continue Watching or Next Up |
| Remote button | Which command it sends |

Every control also has a **Player** setting (see below).

## Choosing which player a control uses

Each control picks a player in this order:

1. **Player** on that control, if you've pinned one
2. **Default player** in the shared settings, if set
3. **Automatic**, which tries a priority user's player first (even if paused), then anything
   that's playing, then the most recently used player

Tick **Ignore other users' players** in the shared settings to stop automatic selection ever
picking someone else's session.

For example, a volume dial in your gaming profile can stay pinned to your desktop app, while a
separate cinema profile follows the default player on the TV.

## Troubleshooting

**The touch strip says Set up, Offline, Bad key or No player.**
Set up means the server address or API key is missing. Offline means the server can't be reached
at that address. Bad key means Jellyfin rejected the API key. No player means nothing matching
your player settings is signed in right now.

**A control shows a warning triangle.**
The player didn't accept that command. Some clients don't support remote menu navigation or track
changes. In the Player dropdown, players without remote volume control are marked.

**Fullscreen doesn't work when the player is a web browser.**
Browsers only allow fullscreen after a click or key press on the page itself, so a remote command
can't trigger it. Use Jellyfin Media Player on that machine, or open the browser in fullscreen to
begin with. For Edge on Windows:
`msedge.exe --start-fullscreen http://your-server:8096`

**The wrong player is being controlled.**
An admin API key can see every session on the server, including other people's. Set a Default player,
pin the control to a player, or add yourself as a priority user.

**Something else.**
The plugin writes logs to the `logs` folder inside the plugin's folder:

- Windows: `%appdata%\Elgato\StreamDeck\Plugins\com.jere.jellyfin-remote.sdPlugin\logs`
- macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.jere.jellyfin-remote.sdPlugin/logs`

Your API key is never written to the logs. Please attach the latest log file if you open an issue.

## Building from source

You need Node.js 24 or newer, the Stream Deck app 7.1 or newer, and the Elgato CLI. Clone or
download this repository, then from its folder:

```
npm install -g @elgato/cli                        # Elgato's command line tool
npm install                                       # project dependencies
npm test                                          # run the tests (no server or deck needed)
npm run build                                     # build the settings pages and the plugin
streamdeck link com.jere.jellyfin-remote.sdPlugin # install your build in the Stream Deck app
npm run watch                                     # rebuild and restart on every save
streamdeck pack com.jere.jellyfin-remote.sdPlugin # make an installable .streamDeckPlugin file
```

Uninstall the released version before running `streamdeck link`, because both use the same ID.

The settings pages in `com.jere.jellyfin-remote.sdPlugin/ui/` are generated by
`scripts/build-ui.mjs`. Edit the script, then run `npm run ui` or `npm run build`.

### Project structure

```
src/
  jellyfin.ts     Talks to Jellyfin. No Stream Deck code, so it can be tested on its own.
  hub.ts          Polls the server once for every control and holds the shared settings.
  playback.ts     Pure helpers: position estimates, time formatting, stepping through tracks.
  actions/        One file per control, plus base.ts (what they share) and look.ts (colours).
  plugin.ts       Registers the controls and loads the shared settings.
scripts/
  build-ui.mjs    Generates the seven settings pages from one template.
com.jere.jellyfin-remote.sdPlugin/
  manifest.json   The controls, their icons and what each gesture does.
  layouts/        The touch strip layout the dial controls share.
  imgs/           Icons for the keys, dials and touch strip.
  ui/             Generated settings pages (don't edit by hand).
test/             Tests against a fake Jellyfin server, plus tests for the pure helpers.
```

### How it works

- **One poll for everything.** If every control polled the server on its own, ten controls would
  mean ten requests every couple of seconds. The hub fetches the session list once and tells every
  visible control to redraw.
- **Throttling.** Spinning a dial sends dozens of events a second. Volume and seek update the
  display straight away but only send the latest value to Jellyfin a few times a second.
  Subtitle changes wait until you stop turning.
- **Optimistic updates.** Players only report their state every few seconds, so the deck shows
  what you just did straight away and trusts that for a short time.
- **Time in ticks.** Jellyfin measures time in ticks of 100 nanoseconds, so 1 second is
  10,000,000 ticks.

## Contributing

Bug reports, ideas and pull requests are welcome. By contributing, you agree that your changes are
released under the same licence as the rest of the project.

## Licence

Jellyfin Remote is free, and meant to stay that way. It is released under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). In plain words:

- **You can** use it, copy it, change it and share it for free, for any noncommercial purpose:
  at home, for a hobby, or in a school, charity or other noncommercial organisation.
- **You can't** sell it, charge for changed versions of it, or use it to make money.
- If you share it or a changed version, include the licence and the copyright notice.

This is a summary, and the licence text is what counts. Because it doesn't allow commercial use,
the project is "source-available" rather than "open source" by the Open Source Initiative's
definition.

## Credits

Icons are based on [Tabler Icons](https://tabler.io/icons), used under the MIT licence (see
`com.jere.jellyfin-remote.sdPlugin/imgs/LICENSE-tabler-icons.txt`).

This is an independent project. It is not affiliated with or endorsed by the Jellyfin project or
Elgato. Jellyfin and Stream Deck are trademarks of their respective owners.
