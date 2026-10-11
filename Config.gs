/**
 * Config.gs — nama sheet, skema, aturan default, dan akses konfigurasi.
 * Tidak ada rahasia di file ini.
 */
var APP = {
  NAME: 'Sistem Absensi Pegawai',
  TZ: 'Asia/Jakarta',
  SHEETS: {
    USERS: 'Users', EMP: 'Pegawai', LOC: 'LokasiKantor', SCH: 'JadwalKerja',
    CAL: 'KalenderKerja', ATT: 'Absensi', LEAVE: 'PengajuanIzin',
    RECAP: 'RekapPotongan', AUDIT: 'AuditLog', CFG: 'Konfigurasi', TRY: 'AttemptLog'
  },
  SCHEMA: {
    Users: ['user_id', 'email_normalized', 'employee_id', 'role', 'status', 'password_hash', 'password_salt', 'created_at', 'updated_at'],
    Pegawai: ['employee_id', 'employee_number', 'full_name', 'email', 'unit', 'position', 'status', 'created_at', 'updated_at'],
    LokasiKantor: ['location_id', 'name', 'latitude', 'longitude', 'radius_m', 'max_accuracy_m', 'active', 'allowed_units', 'updated_by', 'updated_at'],
    JadwalKerja: ['schedule_id', 'day_of_week', 'start_time', 'end_time', 'effective_from', 'effective_to', 'unit', 'active'],
    KalenderKerja: ['calendar_id', 'date', 'day_type', 'title', 'workday_override', 'notes', 'updated_by'],
    Absensi: ['attendance_id', 'employee_id', 'work_date', 'type', 'timestamp_server', 'latitude', 'longitude', 'accuracy_m', 'location_id', 'distance_m', 'validation_status', 'created_at', 'source', 'note', 'corrected_by'],
    PengajuanIzin: ['request_id', 'employee_id', 'leave_type', 'start_date', 'end_date', 'reason', 'attachment_ref', 'status', 'reviewer_id', 'reviewed_at', 'review_note', 'created_at'],
    RekapPotongan: ['record_id', 'employee_id', 'work_date', 'status', 'late_minutes', 'late_amount', 'early_leave_amount', 'missing_in_amount', 'missing_out_amount', 'total_amount', 'rule_version', 'calculated_at'],
    AuditLog: ['log_id', 'actor_id', 'action', 'entity_type', 'entity_id', 'before_json', 'after_json', 'reason', 'timestamp_server'],
    Konfigurasi: ['config_key', 'config_value', 'description', 'updated_by', 'updated_at'],
    AttemptLog: ['attempt_id', 'employee_id', 'attempted_at', 'type', 'result', 'reason_code', 'location_id', 'distance_m', 'accuracy_m']
  },
  // Kolom numerik; semua kolom lain disimpan sebagai teks agar tanggal/jam tidak diubah Sheets.
  NUM_COLS: ['day_of_week', 'latitude', 'longitude', 'accuracy_m', 'distance_m', 'radius_m', 'max_accuracy_m',
    'late_minutes', 'late_amount', 'early_leave_amount', 'missing_in_amount', 'missing_out_amount', 'total_amount'],
  DAY_TYPES: ['LIBUR_NASIONAL', 'CUTI_BERSAMA', 'LIBUR_LOKAL', 'HARI_KERJA_KHUSUS'],
  DEFAULT_RULES: {
    lateTol: 0, rounding: 'ceil', lateThreshold: 60, lateLE: 7500, lateGT: 10000,
    early: 10000, earlyTol: 0, missIn: 10000, missOut: 10000, missBoth: 20000, leaveExempt: true
  },
  DEFAULT_CONFIG: [
    ['timezone', 'Asia/Jakarta', 'Zona waktu (informasi; zona waktu efektif ada di appsscript.json)'],
    ['rule_version', 'v1.0-baseline', 'Versi aturan perhitungan; berubah otomatis saat aturan potongan diubah'],
    ['location_max_age_sec', '120', 'Umur maksimum pembacaan GPS dalam detik (0 = nonaktif)'],
    ['late_tolerance_min', '0', 'Toleransi keterlambatan (menit) — PERLU DISAHKAN'],
    ['late_rounding', 'ceil', 'Pembulatan menit terlambat: ceil atau floor — PERLU DISAHKAN'],
    ['late_threshold_min', '60', 'Batas kategori terlambat ringan (menit)'],
    ['late_amount_le_threshold', '7500', 'Potongan terlambat sampai batas (Rp)'],
    ['late_amount_gt_threshold', '10000', 'Potongan terlambat di atas batas (Rp)'],
    ['early_leave_tolerance_min', '0', 'Toleransi pulang cepat (menit) — PERLU DISAHKAN'],
    ['early_leave_amount', '10000', 'Potongan pulang cepat (Rp)'],
    ['missing_in_amount', '10000', 'Potongan tidak absen masuk (Rp)'],
    ['missing_out_amount', '10000', 'Potongan tidak absen pulang (Rp)'],
    ['missing_both_amount', '20000', 'Total potongan tidak absen masuk dan pulang (Rp)'],
    ['leave_exempts_deduction', 'Y', 'Izin/sakit disetujui membebaskan potongan (Y/N) — PERLU DISAHKAN'],
    ['max_attachment_kb', '2048', 'Ukuran maksimum lampiran izin/sakit (KB)'],
    ['sakit_attachment_required', 'N', 'Lampiran wajib untuk sakit (Y/N)'],
    ['retention_note', 'Tetapkan masa retensi sesuai kebijakan instansi', 'Catatan kebijakan retensi']
  ],
  RULE_KEYS: ['late_tolerance_min', 'late_rounding', 'late_threshold_min', 'late_amount_le_threshold',
    'late_amount_gt_threshold', 'early_leave_tolerance_min', 'early_leave_amount', 'missing_in_amount',
    'missing_out_amount', 'missing_both_amount', 'leave_exempts_deduction']
};

var Cfg = {
  _m: null,
  all: function () {
    if (Cfg._m) return Cfg._m;
    var m = {};
    APP.DEFAULT_CONFIG.forEach(function (d) { m[d[0]] = d[1]; });
    DB.all(APP.SHEETS.CFG).forEach(function (r) { if (r.config_key) m[r.config_key] = String(r.config_value); });
    Cfg._m = m;
    return m;
  },
  reset: function () { Cfg._m = null; },
  num: function (k, def) { var v = Number(Cfg.all()[k]); return isFinite(v) ? v : def; },
  rules: function () {
    var m = Cfg.all(), d = APP.DEFAULT_RULES;
    return {
      lateTol: Cfg.num('late_tolerance_min', d.lateTol),
      rounding: m.late_rounding === 'floor' ? 'floor' : 'ceil',
      lateThreshold: Cfg.num('late_threshold_min', d.lateThreshold),
      lateLE: Cfg.num('late_amount_le_threshold', d.lateLE),
      lateGT: Cfg.num('late_amount_gt_threshold', d.lateGT),
      early: Cfg.num('early_leave_amount', d.early),
      earlyTol: Cfg.num('early_leave_tolerance_min', d.earlyTol),
      missIn: Cfg.num('missing_in_amount', d.missIn),
      missOut: Cfg.num('missing_out_amount', d.missOut),
      missBoth: Cfg.num('missing_both_amount', d.missBoth),
      leaveExempt: String(m.leave_exempts_deduction).toUpperCase() !== 'N'
    };
  },
  list: function () {
    Auth.requireAdmin();
    var m = Cfg.all();
    return APP.DEFAULT_CONFIG.map(function (d) { return { key: d[0], value: m[d[0]], description: d[2] }; });
  },
  set: function (key, value, reason) {
    var admin = Auth.requireAdmin();
    var def = APP.DEFAULT_CONFIG.filter(function (d) { return d[0] === key; })[0];
    if (!def) throw new AppError('VALIDATION', 'Kunci konfigurasi tidak dikenal.');
    if (key === 'timezone' || key === 'rule_version') throw new AppError('VALIDATION', 'Kunci ini dikelola sistem.');
    reason = U.clean(reason, 300);
    if (!reason) throw new AppError('VALIDATION', 'Alasan perubahan wajib diisi.');
    value = String(value == null ? '' : value).trim();
    if (key === 'late_rounding' && ['ceil', 'floor'].indexOf(value) < 0) throw new AppError('VALIDATION', 'Nilai harus ceil atau floor.');
    else if (/_amount|_min$|_kb$|_sec$|_threshold_min|_tolerance_min/.test(key) && (!/^\d+$/.test(value))) throw new AppError('VALIDATION', 'Nilai harus bilangan bulat ≥ 0.');
    else if (/^(leave_exempts_deduction|sakit_attachment_required)$/.test(key) && ['Y', 'N'].indexOf(value) < 0) throw new AppError('VALIDATION', 'Nilai harus Y atau N.');
    var before = Cfg.all()[key], now = U.nowStr(), who = admin.email;
    DB.upsertMany(APP.SHEETS.CFG, 'config_key', [{ config_key: key, config_value: value, description: def[2], updated_by: who, updated_at: now }]);
    if (APP.RULE_KEYS.indexOf(key) >= 0) {
      var ver = 'v' + U.fmt(new Date(), 'yyyyMMdd-HHmmss');
      DB.upsertMany(APP.SHEETS.CFG, 'config_key', [{ config_key: 'rule_version', config_value: ver, description: 'Versi aturan perhitungan', updated_by: who, updated_at: now }]);
    }
    Cfg.reset();
    Audit.log('CONFIG_UPDATE', 'Konfigurasi', key, { value: before }, { value: value }, reason);
    return Cfg.list();
  }
};
