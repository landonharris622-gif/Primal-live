# Primal Live 🦍 (Full) — Fly.io + GitHub

## Features (real, not fake)
- **Accounts**: register/login/logout (sessions)
- **Roles**: VIEWER / CREATOR / ADMIN
- **Admin panel**: promote users, force end streams
- **Persistent DB**: SQLite (`primal_live.db`)
- **Live streaming**: WebRTC screen + mic, camera optional (PiP)
- **Chat**: realtime + stored + staff badges
- **Viewer count**: heartbeat-based, stored
- **Thumbnails**: upload + display
- **VOD recording**: browser MediaRecorder → upload → playback
- **OBS/RTMP (optional)**: Mux RTMP + HLS playback (needs env vars)
- **TURN (optional)**: coturn config included

## Run locally
```bash
npm install
npm start
# http://localhost:3000
```

## Deploy to Fly.io
```bash
fly auth login
fly launch
fly deploy
fly open
```

## Make yourself ADMIN
After you register, run:
```bash
node tools/make-admin.js your@email.com
```

## Enable OBS/RTMP (Mux) (optional)
Set env vars on Fly:
- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`

Then creator dashboard → “Create Mux RTMP”

## TURN (optional, improves connectivity)
See `turn-server/README.md`.
