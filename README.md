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

Semua logika permainan (giliran, validasi kata, nyawa, skor, timer 15 detik
per giliran) berjalan di server (`src/room.js`) sehingga tidak bisa dicurangi
dari sisi client — client hanya mengirim kata yang diketik pemain dan
menampilkan state yang dikirim balik oleh server.

## Testing lokal

```
npm run dev
```
Wrangler akan menjalankan worker di `http://localhost:8787`. Untuk testing
lokal, ubah sementara `WORKER_URL` di file game menjadi
`http://localhost:8787` (dan protokol WebSocket ke `ws://` bukan `wss://` —
sudah otomatis ditangani oleh kode game berdasarkan `https`/`http`).