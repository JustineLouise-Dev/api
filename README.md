# Instalasi Sambung Kata

Panduan pemasangan backend Sambung Kata di VPS, Termux, atau panel
Pterodactyl.

## Persyaratan

- Node.js 18 atau lebih baru
- npm
- File proyek sudah di-upload atau di-clone ke server

## Instalasi umum

Masuk ke folder proyek, lalu jalankan:

```bash
npm install
```

Jalankan aplikasi:

```bash
npm run dev
```

Aplikasi berjalan pada port `8787` secara default.

## VPS Linux

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y nodejs npm git
git clone URL_REPOSITORY
cd api
npm install
npm run dev -- --ip 0.0.0.0 --port 8787
```

Ganti `URL_REPOSITORY` dengan URL repository proyek.

Untuk menjalankan di background menggunakan PM2:

```bash
sudo npm install -g pm2
pm2 start "npm run dev -- --ip 0.0.0.0 --port 8787" --name sambungkata
pm2 save
pm2 startup
```

Pastikan port `8787` dibuka pada firewall VPS jika aplikasi diakses langsung:

```bash
sudo ufw allow 8787/tcp
```

### Menjalankan ulang setelah update

```bash
cd api
git pull
npm install
pm2 restart sambungkata
```

## Termux

```bash
pkg update && pkg upgrade
pkg install nodejs git
git clone URL_REPOSITORY
cd api
npm install
npm run dev -- --ip 0.0.0.0 --port 8787
```

Untuk menjalankan kembali, masuk ke folder proyek dan jalankan:

```bash
npm run dev -- --ip 0.0.0.0 --port 8787
```

Jangan menutup sesi Termux jika aplikasi harus tetap berjalan. Untuk proses
yang tetap hidup setelah terminal ditutup, gunakan `tmux`:

```bash
pkg install tmux
tmux new -s sambungkata
npm run dev -- --ip 0.0.0.0 --port 8787
```

Tekan `Ctrl+B`, lalu `D` untuk keluar dari sesi tanpa menghentikan aplikasi.

## Pterodactyl

1. Buat server baru dengan image Node.js 18 atau lebih baru.
2. Upload atau clone seluruh isi proyek ke server.
3. Atur startup command menjadi:

```bash
npm install && npm run dev -- --ip 0.0.0.0 --port ${SERVER_PORT}
```

4. Jalankan server dari panel.

Gunakan port yang diberikan panel melalui `${SERVER_PORT}`. Jangan mengunci
port ke `8787` pada Pterodactyl karena setiap server biasanya mendapat port
yang berbeda.

## Catatan

- Jalankan semua perintah dari folder yang berisi `package.json`.
- Jangan menghapus folder `src` dan `public`.
- Jika port sudah digunakan, ganti port pada perintah start.
