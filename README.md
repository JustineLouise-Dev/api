# api

# Sambung Kata — Worker Multiplayer Backend

Backend realtime untuk game Sambung Kata, dijalankan sebagai Cloudflare
Worker + Durable Object (satu Durable Object = satu room).

## Cara deploy

1. Install Wrangler (sekali saja):
	```
	npm install -g wrangler
	```

2. Login ke akun Cloudflare kamu:
	```
	wrangler login
	```

3. Dari folder ini, deploy:
	```
	npm install
	npm run deploy
	```

4. Setelah selesai, Wrangler akan menampilkan URL worker kamu, contoh:
	```
	https://sambungkata-worker.<subdomain-kamu>.workers.dev
	```

5. Buka file game (`sambung-kata.html`), cari baris:
	```js
	const WORKER_URL = "https://sambungkata-worker.YOUR-SUBDOMAIN.workers.dev";
	```
	Ganti dengan URL worker kamu dari langkah 4.

## Cara kerja singkat

- `POST /api/room` → membuat room baru, mengembalikan kode room 5 karakter.
- `GET /api/room/:code/exists` → mengecek apakah kode room valid (dipakai saat Join Room).
- `GET /ws/:code?name=Nama` → upgrade ke WebSocket, masuk ke room tsb.
- `GET /api/visits` → (admin only, lihat di bawah) daftar hit yang tercatat.

Semua logika permainan (giliran, validasi kata, nyawa, skor, timer 15 detik
per giliran) berjalan di server (`src/room.js`) sehingga tidak bisa dicurangi
dari sisi client — client hanya mengirim kata yang diketik pemain dan
menampilkan state yang dikirim balik oleh server.

## Admin panel (log koneksi)

Setiap hit ke `/api/room`, `/api/room/:code/exists`, dan upgrade `/ws/:code`
dicatat (fire-and-forget, tidak memperlambat request asli) ke Durable Object
terpisah (`src/visitlog.js`, binding `VISIT_LOG`). Yang disimpan murni data
koneksi mentah — IP, User-Agent, header `cf-*` dari Cloudflare (negara, kota,
ASN, colo, versi TLS/HTTP), Accept-Language, dan header `Sec-Fetch-*` — tanpa
skor atau vonis "ini bot" dari sistem. Keputusan itu diserahkan ke kamu saat
melihat datanya lewat `admin.html`.

Setup:

1. Set admin key sebagai secret (jangan taruh di `wrangler.toml`):
	```
	wrangler secret put ADMIN_KEY
	```
2. Deploy seperti biasa (`npm run deploy`) — migration untuk
   `VisitLogDurableObject` akan otomatis dijalankan.
3. Buka `https://api.justinelouise.workers.dev/admin` dan masukkan admin key
	yang sama.

Baris log dibatasi otomatis ke 5000 entri terakhir (yang lama otomatis
dihapus) supaya storage Durable Object tidak membengkak.

## Testing lokal

```
npm run dev
```
Wrangler akan menjalankan worker di `http://localhost:8787`. Untuk testing
lokal, ubah sementara `WORKER_URL` di file game menjadi
`http://localhost:8787` (dan protokol WebSocket ke `ws://` bukan `wss://` —
sudah otomatis ditangani oleh kode game berdasarkan `https`/`http`).