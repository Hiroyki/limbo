# Chrome Web Store listing

Upload `limbo-2.5.0.zip`. Each language has its own images in `limbo/`.

Before publishing, host `privacy-policy.md` at a public address; the store asks for its link.

The store asks every extension to have a single purpose. Erasing history and locking the browser in one extension may be questioned in review.

**Name:** Limbo: History Eater

**Category:** Privacy & Security

## English

Limbo eats your browsing history.

Click the icon and your history is pulled into the dark. Changed your mind? Click Limbo or press Esc while the ring is still running, and the page comes back untouched.

- Erase everything, the last hour, today, or the last 7 days
- Time to undo: 2, 3, 5 or 10 seconds
- Limbo grows the more you feed it
- Optional: cache, download list, cookies, sound, and erasing when Chrome starts
- Quick links to Google's own pages for deleting saved searches
- English and Indonesian

Limbo Lock, included:

- Hides every Chrome window until the right passcode is entered
- Locks a single tab, or chosen sites
- Locks with a shortcut, when Chrome starts, or when you walk away
- A recovery code in case you forget your passcode
- Limbo shuts its eyes while you type

Limbo asks Chrome to erase your history. It has no permission to read it, and it sends nothing anywhere.

Searches saved in a Google account are kept by Google and can only be deleted on Google's own page. Limbo takes you there. Limbo Lock stops people who pick up your computer. Someone with the skills to get around an extension can get past it, so also lock your computer when you leave it.

## Bahasa Indonesia

Limbo memakan riwayat browsing kamu.

Klik ikonnya, dan riwayatmu tersedot ke dalam gelap. Berubah pikiran? Klik Limbo atau tekan Esc selama garisnya masih berjalan, dan halamannya balik utuh.

- Hapus semua, 1 jam terakhir, hari ini, atau 7 hari terakhir
- Waktu untuk batal: 2, 3, 5, atau 10 detik
- Limbo tumbuh makin sering diberi makan
- Pilihan: cache, daftar unduhan, cookie, suara, dan hapus saat Chrome dibuka
- Jalan pintas ke halaman Google untuk menghapus pencarian tersimpan
- Bahasa Indonesia dan Inggris

Sudah termasuk Limbo Lock:

- Semua jendela Chrome disembunyikan sampai kode sandinya benar
- Mengunci satu tab, atau situs pilihanmu
- Mengunci lewat pintasan, saat Chrome dibuka, atau saat kamu pergi
- Kode pemulihan kalau kamu lupa kode sandi
- Limbo merem selama kamu mengetik

Limbo meminta Chrome menghapus riwayatmu. Limbo tidak punya izin membacanya, dan tidak mengirim apa pun ke mana pun.

Pencarian di akun Google disimpan oleh Google dan hanya bisa dihapus di halaman Google. Limbo mengantarmu ke sana. Limbo Lock menahan orang yang memakai komputermu. Orang yang paham cara mengakali ekstensi bisa melewatinya, jadi kunci juga komputermu saat ditinggal.

## Single purpose

Keep the user's browsing private on a shared computer: erase browsing data on request, and hide Chrome behind a passcode.

## Permission justifications

| Permission | Why |
|---|---|
| `browsingData` | Erases history, and any other data types the user ticks. |
| `activeTab`, `scripting` | Draws the animation and the undo button on the current tab after the user clicks the icon. |
| `contextMenus` | Adds the time ranges, the locks and Settings to the right-click menu. |
| `storage` | Saves settings, usage count and the hashed passcode on this computer. |
| `offscreen` | Plays the optional sound effects. |
| `idle` | Locks after the idle time the user chose. |
| Optional site access | Asked for one site at a time, only when the user locks that site, so Limbo can tell when it is opened. |

Remote code: none. Data collected: none.
