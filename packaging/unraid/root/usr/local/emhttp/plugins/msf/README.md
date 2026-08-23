# msf

`msf` is a free and open-source, user-facing all-in-one management tool for DNS and proxy (mihomo / sing-box, in development).

The Unraid plugin stores persistent data under `/mnt/user/appdata/msf` by default and exposes a lightweight control page under **Settings / MSF Free**. That page only manages the rc service, listen settings, data directory, status, and the link to Open WebUI. The full management interface runs in the separate msf WebUI.

Online MosDNS, Mihomo, and Zashboard downloads are installed only after their GitHub release asset SHA-256 digest verifies. Local uploads are accepted for offline use and are marked as user-supplied `local-upload` files.
