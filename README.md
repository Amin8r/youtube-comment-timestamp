# youtube-comment-timestamp

A userscript for [Violentmonkey](https://violentmonkey.github.io/) (or Tampermonkey) that fixes clicking timestamps in YouTube comments.

By default, clicking a timestamp like `1:23` in a comment scrolls the page all the way back up to the player, so you lose your place in the comments. With this script, clicking a timestamp:

- **keeps the page where it is**, so you can carry on reading,
- **jumps the video to that time** and plays it,
- **opens the video in Picture-in-Picture**, a small window that stays on top of your other windows.

Clicking more timestamps while you read moves the Picture-in-Picture video to each one. When you scroll back up to the player, the video goes back into the page.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/get-it/) (or another userscript manager).
2. Open **[youtube-comment-timestamp.user.js](https://github.com/Amin8r/youtube-comment-timestamp/raw/main/youtube-comment-timestamp.user.js)**. Violentmonkey shows an install page; click **Install**.
3. Reload any YouTube tabs you already have open.

## Settings

On a YouTube page, click the Violentmonkey toolbar icon to see these toggles. Your choices are saved.

| Setting | Default | What it does |
| --- | --- | --- |
| Picture-in-Picture when the player is off-screen | On | Turn this off if you only want the jump without the page scrolling up. |
| Leave Picture-in-Picture when back at the player | On | Puts the video back into the page once at least half of the player is in view again. |
| Also handle timestamps in the description | Off | Handles timestamps and chapter links in the video description the same way. |

## Browser support

- **Chrome, Edge, Brave, Opera, Vivaldi and other Chromium browsers:** Picture-in-Picture opens automatically.
- **Firefox:** Firefox doesn't let web pages or userscripts open Picture-in-Picture, so the script can only jump the video without scrolling. You can open Firefox's Picture-in-Picture yourself (`Ctrl+Shift+]`, `⌘ ⌥ ⇧ ]` on macOS, or the Picture-in-Picture button on the video). Timestamps you click after that play in that window.

## Good to know

- Picture-in-Picture only opens when less than half of the player is on screen. If you can still see the player, for example near the top of the comments on a tall monitor or in fullscreen, the video jumps in place.
- Ctrl-, Cmd-, Shift- and middle-clicking a timestamp work as usual, so you can still open a timestamp in a new tab.
- Timestamps that link to a different video are left alone.
- The Picture-in-Picture window is the browser's own: it has play/pause controls but doesn't show YouTube's captions.
- The script depends on how YouTube builds its pages. If timestamps start scrolling the page up again after a YouTube update, please [open an issue](https://github.com/Amin8r/youtube-comment-timestamp/issues).
