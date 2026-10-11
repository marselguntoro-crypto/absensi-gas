# Aplikasi Absensi Pegawai (Google Apps Script + Google Sheets)

Implementasi PRD v1.0 (11 Oktober 2026): login email terverifikasi, geofence GPS divalidasi di server, jadwal & kalender, izin/sakit, potongan, dashboard, laporan CSV/PDF, audit log.

## Daftar file (semua dibuat di satu proyek Apps Script)
`appsscript.json`, `Code.gs`, `Config.gs`, `Utils.gs`, `Database.gs`, `Auth.gs`, `Audit.gs`, `Employee.gs`, `Calendar.gs`, `Calc.gs`, `Attendance.gs`, `Leave.gs`, `Location.gs`, `Reports.gs`, `Tests.gs`, `Index.html`, `Styles.html`, `Scripts.html`

## Pemasangan
1. Buat Google Sheet kosong → **Ekstensi → Apps Script** (proyek terikat spreadsheet).
2. **Project Settings → centang "Show appsscript.json"**, lalu ganti isinya dengan `appsscript.json` dari paket ini.
3. Buat setiap file `.gs` dan `.html` dengan nama yang sama persis, tempel isinya.
4. Pilih fungsi **`setupSistem`** → Run → setujui izin. Ini membuat semua sheet, konfigurasi default, jadwal default (Sen–Kam 08.15–16.30, Jum 08.15–17.00), folder lampiran privat, dan menjadikan akun Anda administrator pertama. Aman dijalankan ulang (idempoten).
5. (Opsional) Jalankan **`ujiLogika`** dan lihat hasilnya di Execution log.
6. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone within <domain Anda>** (Google Workspace). Buka URL `/exec`.
7. Di aplikasi (menu admin): isi **Lokasi** (koordinat resmi, radius, akurasi → aktifkan), tambah **Pegawai** (email Google mereka), isi **Kalender** hari libur.

Setiap ada perubahan kode: **Deploy → Manage deployments → Edit → New version**.

## Autentikasi & Halaman Login
Aplikasi menyediakan **Halaman Login interaktif** yang mendukung autentikasi mandiri berbasis kata sandi (HMAC token) maupun Single Sign-On (SSO) Google:
- **Identitas login**: Pengguna dapat masuk menggunakan **Email** atau **NIP / Nomor Pegawai**.
- **Kata Sandi default awal**:
  - Administrator pertama: `admin123`
  - Pegawai baru / hasil impor: Menggunakan NIP masing-masing, atau `123456` jika NIP kosong.
- **Pengelolaan kata sandi**:
  - Pengguna dapat mengganti kata sandi sendiri melalui tombol **🔑 Kata Sandi** di bilah atas.
  - Administrator dapat mereset kata sandi pegawai melalui menu **Pegawai** (tombol *Reset Sandi* atau form *Edit*).
  - Kata sandi di-hash menggunakan SHA-256 + salt unik di spreadsheet.
- **Sesi login**: Sesi disimpan aman di browser via HMAC-signed token selama 30 hari atau hingga pengguna menekan tombol **Keluar**.
- **Mode Deployment Web App**:
  - *Execute as*: **Me**
  - *Who has access*: **Anyone** (bisa diakses oleh siapa saja termasuk akun Gmail umum) ATAU **Anyone within domain** (jika khusus Google Workspace).

## Catatan penting
- **Sistem Fallback**: Bila pengguna membuka aplikasi di Google Workspace terautentikasi dan belum memiliki sesi login manual, sistem tetap dapat mengenali akun Google secara otomatis.
- **Butir "perlu disahkan"** (PRD bag. 19) dibuat dapat diatur di menu Pengaturan: toleransi/pembulatan terlambat (default: dibulatkan ke atas, toleransi 0 → masuk 08.15.01 dihitung terlambat 1 menit), toleransi pulang cepat, dan apakah izin/sakit disetujui membebaskan potongan (default: ya).
- Hari kerja khusus tanpa jadwal pada hari itu memakai jadwal Senin.
- GPS browser hanyalah estimasi; spoofing tidak dapat dicegah sepenuhnya (lihat PRD 9.3). Mitigasi: validasi server, batas akurasi, umur data lokasi, AttemptLog, audit.
- Gunakan data fiktif untuk uji awal; batasi akses spreadsheet hanya untuk pengelola.
