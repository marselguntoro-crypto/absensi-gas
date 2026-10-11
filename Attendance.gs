/**
 * Attendance.gs — absensi masuk/pulang dengan validasi server (identitas, jadwal, geofence, akurasi, duplikasi),
 * ringkasan hari ini, riwayat, daftar transaksi admin, dan koreksi tercatat.
 * Semua nilai konfigurasi lokasi dibaca dari sheet, TIDAK dari parameter browser.
 */
var Attendance = {
  _locAllowed: function (loc, unit) {
    var a = String(loc.allowed_units || '*').trim();
    if (a === '' || a === '*') return true;
    return a.split(',').some(function (x) { return x.trim().toLowerCase() === String(unit || '').toLowerCase(); });
  },

  checkin: function (p) {
    var cur = Auth.current(), info = { employee_id: cur.employee.employee_id, type: String((p && p.type) || ''), location_id: '', distance_m: '', accuracy_m: '' };
    try { return Attendance._do(cur, p || {}, info); }
    catch (e) {
      if (e && e.isAppError) {
        try {
          DB.append(APP.SHEETS.TRY, { attempt_id: U.id('TRY'), employee_id: info.employee_id, attempted_at: U.nowStr(), type: info.type, result: 'DITOLAK', reason_code: e.code, location_id: info.location_id, distance_m: info.distance_m, accuracy_m: info.accuracy_m });
        } catch (x) { /* jangan menutupi error asli */ }
      }
      throw e;
    }
  },

  _do: function (cur, p, info) {
    var emp = cur.employee, type = info.type;
    if (['MASUK', 'PULANG'].indexOf(type) < 0) throw new AppError('VALIDATION', 'Jenis absensi tidak valid.');

    var lat = U.num(p.lat), lng = U.num(p.lng), acc = U.num(p.accuracy);
    if (isNaN(lat) || isNaN(lng) || isNaN(acc) || acc < 0) throw new AppError('LOCATION_UNAVAILABLE', 'Lokasi belum terbaca. Aktifkan GPS dan coba kembali.');
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new AppError('LOCATION_INVALID', 'Koordinat tidak valid. Ambil lokasi ulang.');
    info.accuracy_m = Math.round(acc * 10) / 10;

    var maxAge = Cfg.num('location_max_age_sec', 120), posTs = U.num(p.posTs);
    if (maxAge > 0 && !isNaN(posTs) && Math.abs(Date.now() - posTs) / 1000 > maxAge)
      throw new AppError('LOCATION_STALE', 'Data lokasi sudah kedaluwarsa. Ambil lokasi ulang (pastikan jam perangkat benar).');

    var today = U.today();
    var day = Cal.dayInfo(Cal.load(), today, emp.unit);
    if (!day.workday) throw new AppError('NOT_WORKING_DAY', 'Hari ini tidak terjadwal sebagai hari kerja.');

    var locs = DB.all(APP.SHEETS.LOC).filter(function (l) { return String(l.active).toUpperCase() === 'Y' && Attendance._locAllowed(l, emp.unit); });
    if (!locs.length) throw new AppError('LOCATION_NOT_CONFIGURED', 'Lokasi absensi belum dikonfigurasi untuk unit Anda. Hubungi administrator.');
    var best = null;
    locs.forEach(function (l) {
      var la = U.num(l.latitude), lo = U.num(l.longitude), r = U.num(l.radius_m);
      if (isNaN(la) || isNaN(lo) || isNaN(r) || r <= 0) return;
      var d = U.haversine(lat, lng, la, lo);
      if (!best || d < best.d) best = { loc: l, d: d, r: r };
    });
    if (!best) throw new AppError('LOCATION_NOT_CONFIGURED', 'Konfigurasi lokasi kantor belum valid. Hubungi administrator.');
    info.location_id = best.loc.location_id;
    info.distance_m = Math.round(best.d * 10) / 10;

    var maxAcc = U.num(best.loc.max_accuracy_m);
    if (isNaN(maxAcc) || acc > maxAcc) throw new AppError('LOCATION_ACCURACY_LOW', 'Akurasi lokasi belum memenuhi syarat. Ambil lokasi ulang.');
    if (best.d > best.r) throw new AppError('OUTSIDE_GEOFENCE', 'Anda berada di luar radius absensi yang diizinkan.');

    var dup = DB.all(APP.SHEETS.ATT).some(function (r) {
      return r.employee_id === emp.employee_id && r.work_date === today && r.type === type && (r.validation_status === 'VALID' || r.validation_status === 'KOREKSI');
    });
    if (dup) throw new AppError('DUPLICATE_ATTENDANCE', 'Absensi untuk jenis ini sudah tercatat.');

    var now = U.nowStr();
    var rec = {
      attendance_id: U.id('ATT'), employee_id: emp.employee_id, work_date: today, type: type, timestamp_server: now,
      latitude: lat, longitude: lng, accuracy_m: info.accuracy_m, location_id: best.loc.location_id, distance_m: info.distance_m,
      validation_status: 'VALID', created_at: now, source: 'GPS', note: '', corrected_by: ''
    };
    DB.append(APP.SHEETS.ATT, rec);
    return { attendance_id: rec.attendance_id, type: type, time: now.substr(11, 8), distance_m: rec.distance_m, accuracy_m: rec.accuracy_m, location: best.loc.name };
  },

  today: function () {
    var cur = Auth.current(), emp = cur.employee, today = U.today();
    var ctx = Calc.ctxFor(today, today), day = Calc.day(emp, today, ctx), info;
    try { info = Cal.dayInfo(ctx.cal, today, emp.unit); } catch (e) { info = { workday: false, reason: e.message }; }
    var locs = DB.all(APP.SHEETS.LOC).filter(function (l) { return String(l.active).toUpperCase() === 'Y' && Attendance._locAllowed(l, emp.unit); });
    return {
      date: today, now: U.nowStr(), workday: !!info.workday, start: info.start || '', end: info.end || '', reason: info.reason || '',
      done_in: !!day.in_time, done_out: !!day.out_time, calc: day,
      locations: locs.map(function (l) { return { name: l.name, radius_m: l.radius_m, max_accuracy_m: l.max_accuracy_m }; })
    };
  },

  history: function (month) {
    var cur = Auth.current(), emp = cur.employee;
    month = String(month || U.today().substr(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('VALIDATION', 'Bulan tidak valid.');
    var from = month + '-01', to = U.lastDayOfMonth(month), today = U.today();
    if (to > today) to = today;
    if (from > to) return { month: month, rows: [], summary: Calc.summarize([]) };
    var ctx = Calc.ctxFor(from, to);
    var rows = Calc.rows([emp], from, to, ctx).filter(function (r) { return r.is_workday || r.in_time || r.out_time; });
    var s = Calc.summarize(rows)[0] || null;
    return { month: month, rows: rows.reverse(), summary: s };
  },

  list: function (f) {
    Auth.requireAdmin();
    f = f || {};
    var emps = {};
    DB.all(APP.SHEETS.EMP).forEach(function (e) { emps[e.employee_id] = e; });
    var locs = {};
    DB.all(APP.SHEETS.LOC).forEach(function (l) { locs[l.location_id] = l.name; });
    var q = String(f.q || '').toLowerCase();
    var rows = DB.all(APP.SHEETS.ATT).filter(function (r) {
      if (f.from && r.work_date < f.from) return false;
      if (f.to && r.work_date > f.to) return false;
      var e = emps[r.employee_id] || {};
      if (f.unit && e.unit !== f.unit) return false;
      if (f.status && r.validation_status !== f.status) return false;
      return !q || ((e.full_name || '') + ' ' + (e.email || '') + ' ' + (e.employee_number || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.timestamp_server < b.timestamp_server ? 1 : -1; });
    var p = U.page(rows, f.page, f.size);
    p.rows = p.rows.map(function (r) {
      var e = emps[r.employee_id] || {};
      return { attendance_id: r.attendance_id, employee_id: r.employee_id, full_name: e.full_name || '', employee_number: e.employee_number || '', unit: e.unit || '',
        work_date: r.work_date, type: r.type, timestamp_server: r.timestamp_server, latitude: r.latitude, longitude: r.longitude, accuracy_m: r.accuracy_m,
        location: locs[r.location_id] || '', distance_m: r.distance_m, validation_status: r.validation_status, source: r.source, note: r.note };
    });
    return p;
  },

  voidTx: function (id, reason) {
    var admin = Auth.requireAdmin();
    reason = U.clean(reason, 300);
    if (!reason) throw new AppError('VALIDATION', 'Alasan pembatalan wajib diisi.');
    var r = DB.find(APP.SHEETS.ATT, 'attendance_id', id);
    if (!r) throw new AppError('NOT_FOUND', 'Transaksi tidak ditemukan.');
    if (r.validation_status === 'VOID') throw new AppError('VALIDATION', 'Transaksi sudah dibatalkan.');
    DB.update(APP.SHEETS.ATT, 'attendance_id', id, { validation_status: 'VOID', note: reason, corrected_by: admin.email });
    Audit.log('ATTENDANCE_VOID', 'Absensi', id, { status: r.validation_status, type: r.type, work_date: r.work_date, time: r.timestamp_server }, { status: 'VOID' }, reason);
    return true;
  },

  addManual: function (o) {
    var admin = Auth.requireAdmin();
    var empId = String(o.employee_id || ''), date = U.dateParam(o.work_date, ''), type = String(o.type || '').toUpperCase();
    var tm = U.hhmm(o.time), reason = U.clean(o.reason, 300);
    if (!DB.find(APP.SHEETS.EMP, 'employee_id', empId)) throw new AppError('NOT_FOUND', 'Pegawai tidak ditemukan.');
    if (['MASUK', 'PULANG'].indexOf(type) < 0) throw new AppError('VALIDATION', 'Jenis tidak valid.');
    if (isNaN(U.min(tm))) throw new AppError('VALIDATION', 'Jam tidak valid (HH:mm).');
    if (date > U.today()) throw new AppError('VALIDATION', 'Tanggal koreksi tidak boleh di masa depan.');
    if (!reason) throw new AppError('VALIDATION', 'Alasan koreksi wajib diisi.');
    var exists = DB.all(APP.SHEETS.ATT).some(function (r) {
      return r.employee_id === empId && r.work_date === date && r.type === type && (r.validation_status === 'VALID' || r.validation_status === 'KOREKSI');
    });
    if (exists) throw new AppError('DUPLICATE_ATTENDANCE', 'Sudah ada transaksi aktif untuk jenis/tanggal ini. Batalkan terlebih dahulu bila perlu dikoreksi.');
    var now = U.nowStr(), rec = {
      attendance_id: U.id('ATT'), employee_id: empId, work_date: date, type: type, timestamp_server: date + ' ' + tm + ':00',
      latitude: '', longitude: '', accuracy_m: '', location_id: '', distance_m: '', validation_status: 'KOREKSI', created_at: now,
      source: 'ADMIN_CORRECTION', note: reason, corrected_by: admin.email
    };
    DB.append(APP.SHEETS.ATT, rec);
    Audit.log('ATTENDANCE_MANUAL', 'Absensi', rec.attendance_id, null, { employee_id: empId, work_date: date, type: type, time: tm }, reason);
    return { attendance_id: rec.attendance_id };
  }
};
