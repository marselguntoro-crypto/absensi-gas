/**
 * Calendar.gs — jadwal kerja, kalender libur, dan penentuan hari kerja.
 * Dipakai oleh Attendance dan Calc (fungsi dayInfo murni terhadap konteks).
 */
var Cal = {
  load: function () {
    var cal = {};
    DB.all(APP.SHEETS.CAL).forEach(function (r) { if (r.date) cal[String(r.date)] = r; });
    var sch = DB.all(APP.SHEETS.SCH).map(function (s) {
      return { schedule_id: s.schedule_id, day_of_week: Number(s.day_of_week), start_time: U.hhmm(s.start_time), end_time: U.hhmm(s.end_time), effective_from: String(s.effective_from || ''), effective_to: String(s.effective_to || ''), unit: String(s.unit || '*'), active: s.active };
    });
    return { schedules: sch, cal: cal };
  },

  pick: function (ctx, dow, date, unit) {
    var c = ctx.schedules.filter(function (s) {
      return String(s.active).toUpperCase() === 'Y' && s.day_of_week === dow &&
        (!s.effective_from || s.effective_from <= date) && (!s.effective_to || s.effective_to >= date) &&
        (s.unit === '*' || s.unit === '' || s.unit === unit);
    });
    c.sort(function (a, b) {
      var au = (a.unit === unit) ? 1 : 0, bu = (b.unit === unit) ? 1 : 0;
      if (au !== bu) return bu - au;
      return a.effective_from < b.effective_from ? 1 : -1;
    });
    return c[0] || null;
  },

  /** Konfigurasi khusus (unit/tanggal efektif) menang atas default. Kalender menang atas jadwal mingguan. */
  dayInfo: function (ctx, date, unit) {
    var entry = ctx.cal[date] || null, special = false, title = '';
    if (entry) {
      var ov = String(entry.workday_override || '').toUpperCase();
      title = entry.title || entry.day_type;
      if (entry.day_type === 'HARI_KERJA_KHUSUS' || ov === 'Y') special = true;
      else return { workday: false, holiday: true, reason: title };
    }
    var s = Cal.pick(ctx, U.dow(date), date, unit);
    if (!s && special) s = Cal.pick(ctx, 1, date, unit); // hari kerja khusus tanpa jadwal: pakai jadwal Senin
    if (!s) return { workday: false, reason: 'Tidak terjadwal' };
    var st = U.min(s.start_time), en = U.min(s.end_time);
    if (isNaN(st) || isNaN(en) || en <= st) throw new AppError('INVALID_SCHEDULE', 'Jadwal absensi belum dikonfigurasi dengan benar.');
    return { workday: true, start: s.start_time, end: s.end_time, startMin: st, endMin: en, reason: special ? title : '' };
  },

  // ---------- CRUD jadwal ----------
  scheduleList: function () {
    Auth.requireAdmin();
    return DB.all(APP.SHEETS.SCH).map(function (s) {
      return { schedule_id: s.schedule_id, day_of_week: Number(s.day_of_week), start_time: U.hhmm(s.start_time), end_time: U.hhmm(s.end_time), effective_from: s.effective_from, effective_to: s.effective_to, unit: s.unit || '*', active: s.active };
    }).sort(function (a, b) { return a.unit === b.unit ? a.day_of_week - b.day_of_week : (a.unit < b.unit ? -1 : 1); });
  },
  scheduleSave: function (o) {
    Auth.requireAdmin();
    var dow = Number(o.day_of_week), st = U.hhmm(o.start_time), en = U.hhmm(o.end_time);
    var from = String(o.effective_from || '').trim(), to = String(o.effective_to || '').trim();
    var unit = U.clean(o.unit, 80) || '*', active = String(o.active).toUpperCase() === 'N' ? 'N' : 'Y';
    var reason = U.clean(o.reason, 300);
    if (!(dow >= 1 && dow <= 7)) throw new AppError('VALIDATION', 'Hari harus 1 (Senin) sampai 7 (Minggu).');
    if (isNaN(U.min(st)) || isNaN(U.min(en)) || U.min(en) <= U.min(st)) throw new AppError('VALIDATION', 'Jam masuk/pulang tidak valid (pulang harus setelah masuk).');
    if (from && !U.isDate(from)) throw new AppError('VALIDATION', 'Tanggal efektif awal tidak valid.');
    if (to && !U.isDate(to)) throw new AppError('VALIDATION', 'Tanggal efektif akhir tidak valid.');
    if (from && to && to < from) throw new AppError('VALIDATION', 'Tanggal efektif akhir sebelum awal.');
    if (!reason) throw new AppError('VALIDATION', 'Alasan perubahan wajib diisi.');
    var row = { day_of_week: dow, start_time: st, end_time: en, effective_from: from, effective_to: to, unit: unit, active: active };
    if (o.schedule_id) {
      var before = DB.find(APP.SHEETS.SCH, 'schedule_id', o.schedule_id);
      if (!before) throw new AppError('NOT_FOUND', 'Jadwal tidak ditemukan.');
      DB.update(APP.SHEETS.SCH, 'schedule_id', o.schedule_id, row);
      Audit.log('SCHEDULE_UPDATE', 'JadwalKerja', o.schedule_id, { day: before.day_of_week, start: before.start_time, end: before.end_time, unit: before.unit, active: before.active }, row, reason);
    } else {
      row.schedule_id = U.id('SCH');
      DB.append(APP.SHEETS.SCH, row);
      Audit.log('SCHEDULE_CREATE', 'JadwalKerja', row.schedule_id, null, row, reason);
    }
    return Cal.scheduleList();
  },

  // ---------- CRUD kalender ----------
  calendarList: function (year) {
    Auth.requireAdmin();
    year = String(year || U.today().substr(0, 4));
    if (!/^\d{4}$/.test(year)) throw new AppError('VALIDATION', 'Tahun tidak valid.');
    return DB.all(APP.SHEETS.CAL).filter(function (r) { return String(r.date).substr(0, 4) === year; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (r) { return { calendar_id: r.calendar_id, date: r.date, day_type: r.day_type, title: r.title, workday_override: r.workday_override, notes: r.notes }; });
  },
  _calRow: function (o) {
    var date = String(o.date || '').trim(), type = String(o.day_type || '').toUpperCase();
    if (!U.isDate(date)) throw new AppError('VALIDATION', 'Tanggal tidak valid (yyyy-mm-dd).');
    if (APP.DAY_TYPES.indexOf(type) < 0) throw new AppError('VALIDATION', 'Jenis hari tidak valid: ' + APP.DAY_TYPES.join(', '));
    var ov = String(o.workday_override || '').toUpperCase();
    if (['', 'Y', 'N'].indexOf(ov) < 0) throw new AppError('VALIDATION', 'Override hari kerja harus kosong, Y, atau N.');
    var title = U.clean(o.title, 120);
    if (!title) throw new AppError('VALIDATION', 'Judul wajib diisi.');
    return { date: date, day_type: type, title: title, workday_override: ov, notes: U.clean(o.notes, 300) };
  },
  calendarSave: function (o) {
    var admin = Auth.requireAdmin();
    var row = Cal._calRow(o), reason = U.clean(o.reason, 300);
    if (!reason) throw new AppError('VALIDATION', 'Alasan perubahan wajib diisi.');
    row.updated_by = admin.email;
    var dup = DB.all(APP.SHEETS.CAL).filter(function (r) { return r.date === row.date && r.calendar_id !== o.calendar_id; })[0];
    if (dup) throw new AppError('VALIDATION', 'Sudah ada entri kalender pada tanggal tersebut.');
    if (o.calendar_id) {
      var before = DB.find(APP.SHEETS.CAL, 'calendar_id', o.calendar_id);
      if (!before) throw new AppError('NOT_FOUND', 'Entri tidak ditemukan.');
      DB.update(APP.SHEETS.CAL, 'calendar_id', o.calendar_id, row);
      Audit.log('CALENDAR_UPDATE', 'KalenderKerja', o.calendar_id, { date: before.date, day_type: before.day_type, title: before.title }, row, reason);
    } else {
      row.calendar_id = U.id('CAL');
      DB.append(APP.SHEETS.CAL, row);
      Audit.log('CALENDAR_CREATE', 'KalenderKerja', row.calendar_id, null, row, reason);
    }
    return Cal.calendarList(row.date.substr(0, 4));
  },
  calendarDelete: function (id, reason) {
    Auth.requireAdmin();
    reason = U.clean(reason, 300);
    if (!reason) throw new AppError('VALIDATION', 'Alasan wajib diisi.');
    var before = DB.find(APP.SHEETS.CAL, 'calendar_id', id);
    if (!before) throw new AppError('NOT_FOUND', 'Entri tidak ditemukan.');
    DB.remove(APP.SHEETS.CAL, 'calendar_id', id);
    Audit.log('CALENDAR_DELETE', 'KalenderKerja', id, { date: before.date, day_type: before.day_type, title: before.title }, null, reason);
    return Cal.calendarList(String(before.date).substr(0, 4));
  },
  /** rows: [{date, day_type, title, workday_override}] — semua atau tidak sama sekali. */
  calendarImport: function (rows, reason) {
    var admin = Auth.requireAdmin();
    reason = U.clean(reason, 300) || 'Impor kalender';
    if (!Array.isArray(rows) || !rows.length || rows.length > 400) throw new AppError('VALIDATION', 'Jumlah baris harus 1–400.');
    var exist = {}, seen = {}, out = [], errs = [];
    DB.all(APP.SHEETS.CAL).forEach(function (r) { exist[r.date] = 1; });
    rows.forEach(function (o, i) {
      try {
        var r = Cal._calRow(o);
        if (exist[r.date] || seen[r.date]) throw new AppError('VALIDATION', 'Tanggal ' + r.date + ' sudah ada/duplikat.');
        seen[r.date] = 1; r.calendar_id = U.id('CAL'); r.updated_by = admin.email; out.push(r);
      } catch (e) { errs.push('Baris ' + (i + 1) + ': ' + (e.message || e)); }
    });
    if (errs.length) throw new AppError('VALIDATION', errs.slice(0, 8).join(' | '));
    DB.appendMany(APP.SHEETS.CAL, out);
    Audit.log('CALENDAR_IMPORT', 'KalenderKerja', '', null, { count: out.length }, reason);
    return { imported: out.length };
  }
};
