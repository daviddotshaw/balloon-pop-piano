# 🎈 Balloon Pop Piano

A fun kids' PWA game where you pop balloons by playing the right notes on a real piano!  
The song is **Twinkle Twinkle Little Star** — play through all 42 notes to win. 🌟

**[▶ Play it now](https://daviddotshaw.github.io/balloon-pop-piano)**

---

## How to play

1. Open the link on a phone or tablet near your piano
2. Tap **Let's Play!** and allow microphone access when asked
3. Balloons float up the screen — each one shows a note letter and has a colour
4. Play that note on the piano to **pop** the balloon!
5. Work through all the notes to finish the song 🎉

Any octave works — just play the right letter!

---

## Note colours

| Note | Colour |
|------|--------|
| C | 🔴 Red |
| D | 🟠 Orange |
| E | 🟡 Yellow |
| F | 🟢 Green |
| G | 🔵 Blue |
| A | 🟣 Purple |

---

## Features

- 🎤 Real-time pitch detection via microphone (no app install needed)
- 🎈 Guitar Hero–style balloon queue — see the next few notes coming
- 🎵 Rhythm-friendly — short cooldown so repeated notes (C-C) flow naturally
- 🎊 Confetti burst and pop sound on each correct note
- 🌟 Victory plays Twinkle Twinkle Little Star as a fanfare
- 📱 Installable PWA — works offline once loaded
- 🔕 Musical "conductor tap" sound for wrong notes (not a harsh buzzer!)

---

## Tech

Pure HTML / CSS / Canvas / Web Audio API — no frameworks, no dependencies.  
Pitch detection uses autocorrelation on the microphone input.

---

## Deploy your own

1. Fork this repo
2. Go to **Settings → Pages → Deploy from branch → main**
3. Your copy will be live at `https://YOUR-USERNAME.github.io/balloon-pop-piano`

---

## Notes for parents / teachers

- Works best with acoustic or digital piano near the device
- The mic needs to be on the same side as the piano — most phone mics pick up well from 1–2 metres away
- If the mic isn't detecting notes, check browser mic permissions (see the in-app help screen)
- The site must be served over **https://** for mic access to work
