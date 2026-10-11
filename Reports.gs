/**
 * Reports.gs — dashboard, laporan harian/bulanan, ekspor CSV/PDF, dan penyimpanan rekap potongan.
 * Semua filter diterapkan di server.
 */
var Reports = {
  _params: function (f) {
    f = f || {};
    var from = U.dateParam(f.from, 'awal'), to = U.dateParam(f.to, 'akhir');
    if (to < from) throw new AppError('VALIDATION', 'Tanggal akhir sebelum tanggal awal.');
    if (U.daysBetween(from, to) > 92) throw new AppError('VALIDATION', 'Rentang laporan maksimal 93 hari.');
    return { from: from, to: to, unit: U.clean(f.unit, 80), q: U.clean(f.q, 80).toLowerCase() };
  },

  build: function (f) {
    var admin = Auth.requireAdmin(), p = Reports._params(f);
    var ctx = Calc.ctxFor(p.from, p.to), hasTx = {};
    Object.keys(ctx.tx).forEach(function (k) { hasTx[k.split('|')[0]] = 1; });
    var emps = DB.all(APP.SHEETS.EMP).filter(function (e) {
      if (e.status !== 'AKTIF' && !hasTx[e.employee_id]) return false;
      if (p.unit && e.unit !== p.unit) return false;
      return !p.q || (e.full_name + ' ' + e.employee_number + ' ' + e.email).toLowerCase().indexOf(p.q) >= 0;
    }).sort(function (a, b) { return a.full_name < b.full_name ? -1 : 1; });
    if (emps.length * (U.daysBetween(p.from, p.to) + 1) > 25000) throw new AppError('VALIDATION', 'Cakupan laporan terlalu besar. Persempit periode atau filter.');
    var all = Calc.rows(emps, p.from, p.to, ctx);
    var detail = all.filter(function (r) { return r.is_workday || r.in_time || r.out_time; });
    var R = ctx.rules;
    return {
      meta: {
        from: p.from, to: p.to, unit: p.unit || 'Semua unit', q: p.q, generated_at: U.nowStr(), generated_by: admin.email, timezone: APP.TZ,
        rule_version: Cfg.all().rule_version,
        rules: 'Terlambat ≤' + R.lateThreshold + ' menit ' + U.rupiah(R.lateLE) + ', >' + R.lateThreshold + ' menit ' + U.rupiah(R.lateGT) +
          ' (toleransi ' + R.lateTol + ' menit, pembulatan ' + R.rounding + '); pulang cepat ' + U.rupiah(R.early) + '; tidak absen masuk ' + U.rupiah(R.missIn) +
          '; tidak absen pulang ' + U.rupiah(R.missOut) + '; tidak absen keduanya ' + U.rupiah(R.missBoth) + '; izin/sakit disetujui ' + (R.leaveExempt ? 'membebaskan potongan' : 'tidak membebaskan potongan') +
          '; hari libur Rp0.'
      },
      summary: Calc.summarize(all), detail: detail.slice(0, 5000), truncated: detail.length > 5000
    };
  },

  _tableData: function (rep, kind) {
    if (kind === 'detail') {
      return {
        head: ['Tanggal', 'NIP', 'Nama', 'Unit', 'Masuk', 'Pulang', 'Status', 'Terlambat (mnt)', 'Terlambat', 'Pulang cepat', 'Tidak absen masuk', 'Tidak absen pulang', 'Total potongan'],
        rows: rep.detail.map(function (r) { return [r.date, r.employee_number, r.full_name, r.unit, r.in_time, r.out_time, r.status, r.late_minutes, r.late_amount, r.early_leave_amount, r.missing_in_amount, r.missing_out_amount, r.total_amount]; })
      };
    }
    return {
      head: ['NIP', 'Nama', 'Unit', 'Hari kerja', 'Hadir', 'Terlambat (x)', 'Potongan terlambat', 'Pulang cepat (x)', 'Potongan pulang cepat', 'Tidak absen masuk (x)', 'Potongan tidak absen masuk', 'Tidak absen pulang (x)', 'Potongan tidak absen pulang', 'Mangkir', 'Izin', 'Sakit', 'Total potongan'],
      rows: rep.summary.map(function (s) { return [s.employee_number, s.full_name, s.unit, s.work_days, s.hadir, s.terlambat, s.late_total, s.pulang_cepat, s.early_total, s.no_in, s.no_in_total, s.no_out, s.no_out_total, s.mangkir, s.izin, s.sakit, s.total]; })
    };
  },

  export: function (f, kind, format) {
    var admin = Auth.requireAdmin();
    kind = kind === 'detail' ? 'detail' : 'summary';
    format = format === 'pdf' ? 'pdf' : 'csv';
    var rep = Reports.build(f), t = Reports._tableData(rep, kind), m = rep.meta;
    var base = 'rekap-' + kind + '-' + m.from + '_' + m.to;
    Audit.log('REPORT_EXPORT', 'Laporan', base, null, { kind: kind, format: format, from: m.from, to: m.to, unit: m.unit, rows: t.rows.length }, '');
    if (format === 'csv') {
      var lines = [
        ['Laporan', kind === 'detail' ? 'Rekap harian' : 'Rekap per pegawai'], ['Periode', m.from + ' s.d. ' + m.to], ['Unit', m.unit], ['Zona waktu', m.timezone],
        ['Dibuat', m.generated_at], ['Dibuat oleh', m.generated_by], ['Versi aturan', m.rule_version], ['Aturan', m.rules], []
      ].map(function (r) { return r.map(U.csvCell).join(','); });
      lines.push(t.head.map(U.csvCell).join(','));
      t.rows.forEach(function (r) { lines.push(r.map(U.csvCell).join(',')); });
      var csv = '\uFEFF' + lines.join('\r\n');
      return { filename: base + '.csv', mime: 'text/csv', base64: Utilities.base64Encode(Utilities.newBlob(csv, 'text/csv').getBytes()) };
    }
    var h = '<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:8pt}h2{margin:0 0 4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:2px 3px;text-align:left}th{background:#e8eefc}.m{margin:0 0 2px}</style></head><body>';
    h += '<h2>Laporan ' + (kind === 'detail' ? 'Rekap Harian' : 'Rekap per Pegawai') + ' — ' + U.esc(APP.NAME) + '</h2>';
    h += '<p class="m">Periode: ' + m.from + ' s.d. ' + m.to + ' | Unit: ' + U.esc(m.unit) + ' | Zona waktu: ' + m.timezone + '</p>';
    h += '<p class="m">Dibuat: ' + m.generated_at + ' oleh ' + U.esc(m.generated_by) + ' | Versi aturan: ' + U.esc(m.rule_version) + '</p>';
    h += '<p class="m">Aturan: ' + U.esc(m.rules) + '</p><table><tr>' + t.head.map(function (c) { return '<th>' + U.esc(c) + '</th>'; }).join('') + '</tr>';
    t.rows.forEach(function (r) { h += '<tr>' + r.map(function (c) { return '<td>' + U.esc(c) + '</td>'; }).join('') + '</tr>'; });
    h += '</table></body></html>';
    var pdf = Utilities.newBlob(h, 'text/html', base + '.html').getAs('application/pdf');
    return { filename: base + '.pdf', mime: 'application/pdf', base64: Utilities.base64Encode(pdf.getBytes()) };
  },

  /** Menyimpan hasil perhitungan final ke RekapPotongan (upsert per pegawai+tanggal) dengan versi aturan. */
  saveRecap: function (f) {
    Auth.requireAdmin();
    var rep = Reports.build(f), now = U.nowStr(), ver = Cfg.all().rule_version;
    var objs = rep.detail.filter(function (r) { return r.is_workday && r.final; }).map(function (r) {
      return { record_id: 'RP-' + r.employee_id + '-' + r.date, employee_id: r.employee_id, work_date: r.date, status: r.status, late_minutes: r.late_minutes, late_amount: r.late_amount,
        early_leave_amount: r.early_leave_amount, missing_in_amount: r.missing_in_amount, missing_out_amount: r.missing_out_amount, total_amount: r.total_amount, rule_version: ver, calculated_at: now };
    });
    DB.upsertMany(APP.SHEETS.RECAP, 'record_id', objs);
    Audit.log('RECAP_SAVE', 'RekapPotongan', '', null, { from: rep.meta.from, to: rep.meta.to, unit: rep.meta.unit, rows: objs.length, rule_version: ver }, 'Perhitungan ulang disimpan');
    return { saved: objs.length, rule_version: ver };
  },

  dashboard: function (date, unit) {
    Auth.requireAdmin();
    date = date ? U.dateParam(date, '') : U.today();
    unit = U.clean(unit, 80);
    var emps = DB.all(APP.SHEETS.EMP).filter(function (e) { return e.status === 'AKTIF' && (!unit || e.unit === unit); });
    var from = U.addDays(date, -13), ctx = Calc.ctxFor(from, date);
    var c = { total: emps.length, workday: 0, hadir: 0, belum_masuk: 0, belum_pulang: 0, terlambat: 0, pulang_cepat: 0, izin: 0, sakit: 0, mangkir: 0 };
    emps.forEach(function (e) {
      var r = Calc.day(e, date, ctx);
      if (!r.is_workday) return;
      c.workday++;
      if (r.in_time) c.hadir++;
      if (!r.in_time && r.status !== 'IZIN' && r.status !== 'SAKIT') c.belum_masuk++;
      if (r.in_time && !r.out_time) c.belum_pulang++;
      if (r.late_amount > 0) c.terlambat++;
      if (r.early_leave_amount > 0) c.pulang_cepat++;
      if (r.status === 'IZIN') c.izin++;
      if (r.status === 'SAKIT') c.sakit++;
      if (r.status === 'MANGKIR') c.mangkir++;
    });
    var ids = {}; emps.forEach(function (e) { ids[e.employee_id] = 1; });
    var trend = U.range(from, date).map(function (d) {
      var n = 0; Object.keys(ctx.tx).forEach(function (k) { var p = k.split('|'); if (p[1] === d && ids[p[0]] && ctx.tx[k].in) n++; });
      return { date: d, hadir: n };
    });
    var names = {}; DB.all(APP.SHEETS.EMP).forEach(function (e) { names[e.employee_id] = e; });
    var recent = DB.all(APP.SHEETS.ATT).filter(function (r) { return r.validation_status === 'VALID' || r.validation_status === 'KOREKSI'; })
      .sort(function (a, b) { return a.timestamp_server < b.timestamp_server ? 1 : -1; }).slice(0, 15).map(function (r) {
        var e = names[r.employee_id] || {};
        return { full_name: e.full_name || '', unit: e.unit || '', type: r.type, timestamp_server: r.timestamp_server, distance_m: r.distance_m, validation_status: r.validation_status };
      });
    var pending = DB.all(APP.SHEETS.LEAVE).filter(function (l) { return l.status === 'Menunggu'; }).length;
    return { date: date, counts: c, trend: trend, recent: recent, pending_leave: pending, units: Employee.units() };
  }
};
