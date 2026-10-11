/**
 * Calc.gs — perhitungan status harian dan potongan (PRD bagian 8).
 * Calc.day() murni terhadap konteks (ctx) sehingga dapat diuji tanpa Spreadsheet.
 */
var Calc = {
  OFF: ['LIBUR', 'BELUM_TERDAFTAR', 'AKAN_DATANG', 'JADWAL_TIDAK_VALID'],

  ctxFor: function (from, to) {
    var tx = {};
    DB.all(APP.SHEETS.ATT).forEach(function (r) {
      if (r.work_date < from || r.work_date > to) return;
      if (r.validation_status !== 'VALID' && r.validation_status !== 'KOREKSI') return;
      var k = r.employee_id + '|' + r.work_date, o = tx[k] || (tx[k] = { in: '', out: '' }), t = String(r.timestamp_server);
      if (r.type === 'MASUK') { if (!o.in || t < o.in) o.in = t; }
      else if (r.type === 'PULANG') { if (!o.out || t > o.out) o.out = t; }
    });
    var leaves = DB.all(APP.SHEETS.LEAVE).filter(function (l) { return l.status === 'Disetujui' && l.end_date >= from && l.start_date <= to; });
    return { rules: Cfg.rules(), cal: Cal.load(), tx: tx, leaves: leaves, today: U.today(), nowSec: U.secOfDay(U.nowStr()) };
  },

  leaveFor: function (ctx, empId, date) {
    for (var i = 0; i < ctx.leaves.length; i++) {
      var l = ctx.leaves[i];
      if (l.employee_id === empId && l.start_date <= date && l.end_date >= date) return l;
    }
    return null;
  },

  day: function (emp, date, ctx) {
    var R = ctx.rules, t = ctx.tx[emp.employee_id + '|' + date] || { in: '', out: '' };
    var res = {
      date: date, employee_id: emp.employee_id, employee_number: emp.employee_number || '', full_name: emp.full_name,
      unit: emp.unit || '', status: '', is_workday: false, final: true,
      in_time: t.in ? String(t.in).substr(11, 8) : '', out_time: t.out ? String(t.out).substr(11, 8) : '',
      late_minutes: 0, late_amount: 0, early_leave_amount: 0, missing_in_amount: 0, missing_out_amount: 0,
      total_amount: 0, note: ''
    };
    if (date > ctx.today) { res.status = 'AKAN_DATANG'; res.final = false; return res; }
    var startDate = String(emp.created_at || '').substr(0, 10);
    if (startDate && date < startDate) { res.status = 'BELUM_TERDAFTAR'; return res; }

    var info;
    try { info = Cal.dayInfo(ctx.cal, date, emp.unit); }
    catch (e) { res.status = 'JADWAL_TIDAK_VALID'; res.note = e.message; return res; }
    if (!info.workday) { res.status = 'LIBUR'; res.note = info.reason || ''; return res; }
    res.is_workday = true;

    var leave = Calc.leaveFor(ctx, emp.employee_id, date);
    var leaveLabel = leave ? (leave.leave_type === 'SAKIT' ? 'SAKIT' : 'IZIN') : '';
    if (leave && R.leaveExempt) { res.status = leaveLabel; res.note = 'Izin/sakit disetujui'; return res; }

    var pending = date === ctx.today && ctx.nowSec < info.endMin * 60;
    if (pending) res.final = false;
    var hasIn = !!t.in, hasOut = !!t.out, parts = [];

    if (hasIn) {
      var diff = U.secOfDay(t.in) - info.startMin * 60;
      var m = diff > 0 ? (R.rounding === 'floor' ? Math.floor(diff / 60) : Math.ceil(diff / 60)) : 0;
      if (m > R.lateTol) {
        res.late_minutes = m;
        res.late_amount = m <= R.lateThreshold ? R.lateLE : R.lateGT; // satu kali per tanggal
        parts.push('TERLAMBAT');
      }
    }
    if (hasOut) {
      var early = info.endMin * 60 - U.secOfDay(t.out);
      if (early > 0 && Math.ceil(early / 60) > R.earlyTol) { res.early_leave_amount = R.early; parts.push('PULANG CEPAT'); }
    }
    var both = false;
    if (!pending) {
      if (!hasIn && !hasOut) {
        res.missing_in_amount = R.missIn; res.missing_out_amount = R.missOut; both = true;
        parts = ['MANGKIR']; res.note = 'Tidak absen masuk dan pulang: total tetap';
      } else {
        if (!hasIn) { res.missing_in_amount = R.missIn; parts.push('TIDAK ABSEN MASUK'); }
        if (!hasOut) { res.missing_out_amount = R.missOut; parts.push('TIDAK ABSEN PULANG'); }
      }
    }
    res.total_amount = both ? R.missBoth :
      res.late_amount + res.early_leave_amount + res.missing_in_amount + res.missing_out_amount;

    if (leave) res.status = leaveLabel;
    else if (parts.length) res.status = parts.join(', ');
    else res.status = pending && !hasIn ? 'BELUM ABSEN' : 'HADIR';
    return res;
  },

  rows: function (emps, from, to, ctx) {
    var dates = U.range(from, to), out = [];
    emps.forEach(function (e) { dates.forEach(function (d) { out.push(Calc.day(e, d, ctx)); }); });
    return out;
  },

  summarize: function (rows) {
    var by = {}, order = [];
    rows.forEach(function (r) {
      var s = by[r.employee_id];
      if (!s) {
        s = by[r.employee_id] = { employee_id: r.employee_id, employee_number: r.employee_number, full_name: r.full_name, unit: r.unit,
          work_days: 0, hadir: 0, terlambat: 0, late_total: 0, pulang_cepat: 0, early_total: 0, no_in: 0, no_in_total: 0,
          no_out: 0, no_out_total: 0, mangkir: 0, izin: 0, sakit: 0, total: 0 };
        order.push(s);
      }
      if (!r.is_workday) return;
      s.work_days++;
      if (r.in_time) s.hadir++;
      if (r.late_amount > 0) { s.terlambat++; s.late_total += r.late_amount; }
      if (r.early_leave_amount > 0) { s.pulang_cepat++; s.early_total += r.early_leave_amount; }
      if (r.missing_in_amount > 0) { s.no_in++; s.no_in_total += r.missing_in_amount; }
      if (r.missing_out_amount > 0) { s.no_out++; s.no_out_total += r.missing_out_amount; }
      if (r.status === 'MANGKIR') s.mangkir++;
      if (r.status === 'IZIN') s.izin++;
      if (r.status === 'SAKIT') s.sakit++;
      s.total += r.total_amount;
    });
    return order;
  }
};
