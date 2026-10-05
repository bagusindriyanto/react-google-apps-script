# Google Apps Script + React + TypeScript

Starter untuk web app Google Apps Script dengan React, Vite, Tailwind CSS, dan backend TypeScript. Setiap file implementasi `.ts` di `server/` menjadi satu file `.gs`; backend memakai fungsi global agar dapat saling dipanggil antarfile.

## Persiapan

Gunakan Node.js 24 dan pnpm. Project menyertakan clasp sebagai dependency lokal, sehingga tidak perlu memasangnya secara global.

```sh
pnpm install
pnpm dev
```

Buka alamat localhost yang ditampilkan Vite. Contoh daftar produk memakai mock saat development lokal tanpa `google.script.run`. Google APIs seperti `SpreadsheetApp` tetap dieksekusi di server Apps Script.

## Struktur

```text
src/                     React dan helper runGas
server/
  code.ts                doGet untuk menyajikan HTML
  products.ts            API contoh getProducts
  types.d.ts             alias tipe global backend
  appsscript.json        manifest Apps Script
shared/contracts.d.ts    kontrak API dan tipe bersama
scripts/                 compiler backend dan pengujian

dist/                    hasil build, tidak disimpan dalam Git
  index.html             React, JavaScript, dan CSS dalam satu HTML
  appsscript.json
  server/
    code.gs
    products.gs
```

Subfolder dipertahankan: `server/services/report.ts` menjadi `dist/server/services/report.gs`. File `.d.ts` hanya menyediakan tipe dan tidak menghasilkan `.gs`.

## Perintah

| Perintah | Kegunaan |
| --- | --- |
| `pnpm dev` | React dengan HMR dan mock lokal |
| `pnpm typecheck` | Validasi backend, nama global, hasil kompilasi, dan tipe seluruh project |
| `pnpm typecheck:watch` | Pemeriksaan tipe TypeScript saat file berubah |
| `pnpm lint` | ESLint untuk frontend, backend, dan script build |
| `pnpm test` | Uji compiler, bentrok nama, pemanggilan antarfile, dan output lama |
| `pnpm build:client` | Build frontend; membersihkan `dist/` |
| `pnpm build:server` | Validasi dan build semua backend `.gs`; salin manifest |
| `pnpm build` | Typecheck, build frontend, lalu backend |
| `pnpm push` | Build lengkap; jika berhasil, kirim dengan clasp |
| `pnpm gas:login` | Login akun Google untuk clasp |
| `pnpm gas:status` | Lihat file yang akan dikirim |
| `pnpm gas:open` | Buka editor project Apps Script |
| `pnpm preview` | Preview hasil HTML production secara lokal |

`typecheck:watch` menjalankan compiler TypeScript; aturan AST tambahan diperiksa oleh `typecheck`, `build:server`, dan `build`. `preview` tidak menyediakan mock karena memakai build production: pemanggilan API akan menghasilkan pesan untuk membuka web app Apps Script.

## Menghubungkan Apps Script

1. Buat atau gunakan project Google Apps Script dan ambil **Script ID** dari Project Settings.
2. Aktifkan Google Apps Script API di [pengaturan Apps Script](https://script.google.com/home/usersettings).
3. Salin `.clasp.example.json` menjadi `.clasp.json` jika file lokal ini belum tersedia.
4. Isi `scriptId` dengan Script ID project tujuan. `rootDir` harus `dist`.
5. Jalankan:

```sh
pnpm gas:login
pnpm build
pnpm gas:status
pnpm push
```

`.clasp.json` dan kredensial `.clasprc.json` diabaikan oleh Git. `.claspignore` membatasi kiriman ke `index.html`, `appsscript.json`, dan `.gs` dalam `dist/server/`; pola ignore relatif terhadap `rootDir`.

Push mengganti isi project Apps Script dengan hasil build. Pastikan Script ID mengarah ke project yang memang akan dikelola starter ini. Jangan mengedit file dalam `dist/`: build berikutnya akan menggantinya. `clasp pull` mengambil kode hasil kompilasi ke `dist/`, tanpa mengubahnya kembali menjadi TypeScript.

## Menulis backend

Definisikan fungsi bernama di file mana pun dalam `server/`:

```ts
// server/services/report.ts
function getReportTitle(): string {
  return 'Laporan produk';
}

// server/reports.ts
function getReport() {
  // Fungsi file lain tersedia langsung, tanpa import.
  return { title: getReportTitle(), products: getProducts() };
}
```

Semua file `.gs` berbagi scope global. Build menolak deklarasi global duplikat, termasuk fungsi, variabel, class, nama hasil destructuring, dan helper yang dihasilkan compiler. Pesan menunjukkan nama serta kedua lokasi sumbernya. Nama tidak diubah otomatis.

```text
Nama global "getProducts" duplikat: server/a.ts:1:10 dan server/b.ts:3:10.
```

Variabel `const` yang berisi fungsi juga diperiksa. Nama lokal dalam fungsi atau block berbeda boleh sama. Pemeriksaan mencakup deklarasi statis; jangan membuat atau mengganti fungsi global secara dinamis melalui `globalThis` atau `eval`.

Backend harus berupa script global. `import`, `export`, `require`, dan dynamic import tidak didukung, termasuk `import type` di file implementasi karena dapat membuat file diperlakukan sebagai module. Panggil fungsi antarfile langsung. Hindari eksekusi yang bergantung pada urutan file di top level; lakukan pemanggilan tersebut di dalam fungsi.

Untuk helper internal, gunakan nama yang berakhiran `_`, misalnya `formatProductName_`. Apps Script tidak mengizinkan pemanggilan fungsi tersebut melalui `google.script.run`; namanya tetap harus unik jika didefinisikan secara global.

## Tipe bersama dan API frontend

Kontrak tersedia di `shared/contracts.d.ts`. Backend mendapatkan alias global dari `server/types.d.ts`:

```ts
// server/types.d.ts
type Product = import('../shared/contracts').Product;
type GasFunctions = import('../shared/contracts').GasFunctions;
```

Type query tersebut hanya dipakai compiler dan tidak menghasilkan import JavaScript. React memakai `import type` biasa; `src/types/product.ts` menyediakan re-export tipe produk.

API contoh saat ini adalah `getProducts(): Product[]`, yang mengembalikan data contoh tanpa menyimpan data. Untuk menambah API:

1. Tambahkan signature pada `GasFunctions` di `shared/contracts.d.ts`.
2. Implementasikan fungsi global dengan nama yang sama di `server/`. Gunakan `Parameters<GasFunctions['namaFungsi']>` dan `ReturnType<GasFunctions['namaFungsi']>` untuk menyelaraskan argumen dan respons bila diperlukan.
3. Tambahkan implementasi mock dengan signature sama di `src/lib/gas.mock.ts`.
4. Panggil dari React:

```ts
import { runGas } from '@/lib/gas';

const products = await runGas('getProducts');
```

Nama API, argumen, dan respons mengikuti kontrak TypeScript. `runGas` memakai bridge Apps Script ketika tersedia, termasuk dalam mode development. Mock hanya digunakan ketika mode development tidak memiliki bridge. Build production tidak menyertakan fallback mock.

Parameter dan respons harus mengikuti batasan [google.script.run](https://developers.google.com/apps-script/guides/html/communication), misalnya data sederhana yang bisa dikirim antar client dan server. Ubah nilai `Date` menjadi string sebelum mengirimkannya.

## Push dan deployment web app

`pnpm push` memeriksa dan membangun project sebelum mengirimnya. Kegagalan validasi, typecheck, atau build menghentikan push. Build backend memvalidasi semua file sebelum mengganti output; output `.gs` lama dibersihkan saat rebuild berhasil agar rename atau penghapusan sumber tidak meninggalkan script usang.

Untuk mencoba backend:

1. Setelah push, buka project dengan `pnpm gas:open`.
2. Gunakan **Deploy → Test deployments → Web app** dan buka URL `/dev` sebagai pengguna yang memiliki akses editor. Halaman ini memakai kode terbaru yang sudah di-push.
3. Pastikan daftar produk tampil dan tombol **Muat ulang** bekerja. Fungsi `getProducts` juga dapat dijalankan dari editor.
4. Untuk URL `/exec`, buat deployment web app atau perbarui deployment yang ada ke versi baru. Tentukan identitas eksekusi dan akses sesuai kebutuhan project.

Push tidak otomatis membuat atau memperbarui deployment versi. Ubah timezone dan pengaturan lain pada `server/appsscript.json` sesuai kebutuhan project.
