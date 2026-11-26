# Jellyfin Remote: a Stream Deck + plugin

A cinema-style remote for Jellyfin, for any player on your server: your own app while gaming,
or the TV machine from the sofa. It talks to Jellyfin's built-in remote-control API, so nothing
needs installing on the server.

## The controls

| Control | Turn | Press | Tap the strip | Hold the strip |
|---|---|---|---|---|
| **Volume** (dial) | Volume | Play / pause | Mute | |
| **Seek** (dial) | Seek (5s-1min per click) | Play / pause | Left half: back 10s, right half: forward 30s | Stop |
| **Subtitles & audio** (dial) | Step through subtitles | Next audio track | Subtitles off / back on | Next audio track |
| **Navigate menus** (dial) | Left/right; hold the dial and turn for up/down | Click for OK | Back | Home |
| **Continue watching** (dial) | Choose from Continue Watching | Play from where you left off | Switch to Next Up and back | Play from the start |
| **Now playing** (key) | | Play / pause | | |
| **Remote button** (key) | | Any of 19 buttons, picked in its settings | | |

**Resume** carries on if paused, or after Stop plays the top of that user's Continue Watching
from where they left off. Continue watching and Resume use the lists of the user signed in on
the player.

Now playing shows the poster of what's playing (the series poster for an episode). Leave its icon
as the default in Stream Deck, or the artwork can't be shown.

Remote button can be: play/pause, stop, resume, next, previous, back 10s, forward 30s, next subtitles,
next audio track, mute, up, down, left, right, OK, back, home, menu, info, fullscreen.

## Setup

1. In Jellyfin, go to **Dashboard > API Keys**, create a key and name it "Stream Deck".
2. Double-click `com.jere.jellyfin-remote.streamDeckPlugin`.
3. Drag any Jellyfin Remote control onto the deck. Under **Shared by every Jellyfin control**,
   enter the server address and API key. You only do this once; every control uses them.

## Choosing which player a control drives

- **Player** (on each control): pin that control to one player, or leave it on "Shared default".
- **Default player** (shared): the player every control uses unless it pins its own.
- **Automatic**: if no player is chosen, a **priority user's** player comes first (even if paused),
  then whatever's playing, then the most recently used. Tick **Ignore other users' players** to
  never touch anyone else's session.

So a WoW volume dial can pin your desktop app while the whole cinema profile follows the TV.

If a control shows a warning triangle, the player can't do that command (for example, some apps
don't accept remote menu navigation). Settings dropdowns mark players without remote volume.

## How it's put together

```
src/
  jellyfin.ts     Talks to Jellyfin. No Stream Deck code, so it can be tested on its own.
  hub.ts          Polls the server once for every control, holds the shared settings.
  playback.ts     Pure helpers: position estimates, time formatting, stepping through tracks.
  actions/        One file per control, plus base.ts (what they share) and look.ts (colours).
  plugin.ts       Registers the controls and loads the shared settings.
scripts/
  build-ui.mjs    Generates the six settings pages from one template.
com.jere.jellyfin-remote.sdPlugin/
  manifest.json   The controls, their icons and what each gesture does.
  layouts/        The touch strip layout all four dials share.
  ui/             Generated settings pages (don't edit by hand).
test/             Fake Jellyfin server tests, plus tests for the pure helpers.
```

Worth knowing from the code:

- **One poll for everything.** Ten controls polling separately would be ten requests every few
  seconds. The hub fetches sessions once and tells every visible control to redraw.
- **Throttling.** Spinning a dial fires dozens of events. Volume and seek show the new value
  straight away and send only the latest one a few times a second. Subtitles wait until you stop.
- **Optimistic updates.** The deck shows what you just did immediately and trusts that for a few
  seconds, because players only report their state every few seconds.
- **Time in ticks.** Jellyfin measures time in 100-nanosecond ticks: 1 second = 10,000,000.

## Changing it

You need Node.js 24 or newer and the Stream Deck app 7.1 or newer.

```
npm install -g @elgato/cli
npm install
npm test                                          # 46 tests, no server or deck needed
npm run build                                     # settings pages + compile into .sdPlugin/bin
streamdeck link com.jere.jellyfin-remote.sdPlugin # run from this folder (uninstall the packaged one first)
npm run watch                                     # rebuild and restart on every save
streamdeck pack com.jere.jellyfin-remote.sdPlugin # make a new installable file
```

Logs are in `com.jere.jellyfin-remote.sdPlugin/logs/`. The level is `info` on purpose: at
`trace`, every message is logged, including your API key.

## Licence

Jellyfin Remote is free, and meant to stay that way. It's released under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). In plain words:

- **You can** use it, copy it, change it and share it, for free, for any noncommercial purpose:
  at home, for a hobby, in a school, charity or other noncommercial organisation.
- **You can't** sell it, charge for changed versions of it, or use it to make money.
- If you share it or a changed version, pass the licence and the copyright notice on with it.

This is a summary; the licence text is what counts. (Note: because it forbids commercial use,
it's "source-available" rather than "open source" by the Open Source Initiative's definition.)

## Credits

Icons are drawn from [Tabler Icons](https://tabler.io/icons) (MIT licence; see
`com.jere.jellyfin-remote.sdPlugin/imgs/LICENSE-tabler-icons.txt`). Jellyfin is a trademark of
the Jellyfin project; this plugin is an independent, unofficial remote that uses its public API.
