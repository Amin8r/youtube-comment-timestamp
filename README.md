# youtube-comment-timestamp

A userscript for [Violentmonkey](https://violentmonkey.github.io/) (or Tampermonkey) that fixes clicking timestamps in YouTube comments.

By default, clicking a timestamp like `1:23` in a comment scrolls the page all the way back up to the player, so you lose your place in the comments. With this script, clicking a timestamp:

- **keeps the page where it is**, so you can carry on reading,
- **jumps the video to that time** and plays it,
- **shows the video in a mini-player** in the bottom-right corner of the page, with YouTube's usual controls.

Clicking more timestamps while you read moves the mini-player's video to each one. When you scroll back up to the player, the video goes back into the page. The **×** above the mini-player closes it and pauses the video.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/get-it/) (or another userscript manager).
2. Open **[youtube-comment-timestamp.user.js](https://github.com/Amin8r/youtube-comment-timestamp/raw/main/youtube-comment-timestamp.user.js)**. Violentmonkey shows an install page; click **Install**.
3. Reload any YouTube tabs you already have open.

## Settings

On a YouTube page, click the Violentmonkey toolbar icon to see these toggles. Your choices are saved.

| Setting | Default | What it does |
| --- | --- | --- |
| Mini-player when the player is off-screen | On | Turn this off if you only want the jump without the page scrolling up. |
| Use a Picture-in-Picture window instead of the in-page mini-player | Off | Shows the video in the browser's Picture-in-Picture window, which stays on top of your other windows. Chrome, Edge, Brave, Opera and other Chromium browsers only; elsewhere the in-page mini-player is used. |
| Put the video back when you scroll up to the player | On | Closes the mini-player once at least half of the player's spot is in view again. |
| Also handle timestamps in the description | Off | Handles timestamps and chapter links in the video description the same way. |

## Good to know

- The mini-player only opens when less than half of the player is on screen. If you can still see the player, for example near the top of the comments on a tall monitor or in fullscreen, the video jumps in place.
- The mini-player also closes when you go to another page or switch to fullscreen.
- Ctrl-, Cmd-, Shift- and middle-clicking a timestamp work as usual, so you can still open a timestamp in a new tab.
- Timestamps that link to a different video are left alone.
- The Picture-in-Picture window (if you turn it on) is the browser's own: it has play/pause controls but doesn't show YouTube's captions.
- The script depends on how YouTube builds its pages. If timestamps start scrolling the page up again, or the mini-player looks wrong after a YouTube update, please [open an issue](https://github.com/Amin8r/youtube-comment-timestamp/issues).
