/**
 * Tests.gs — uji logika murni (tanpa Spreadsheet, data fiktif). Jalankan: ujiLogika() dari editor.
 * Mencakup TC-11 s.d. TC-18 serta geodesi dan sanitasi ekspor CSV.
 * Hasil uji nyata hanya valid bila fungsi ini benar-benar dijalankan di lingkungan Anda.
 */
function ujiLogika() {
  var out = [], fail = 0;
  function eq(name, got, want) {
    var ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    out.push((ok ? 'LULUS  ' : 'GAGAL  ') + name + (ok ? '' : '  → dapat ' + JSON.stringify(got) + ', seharusnya ' + JSON.stringify(want)));
  }
  function mk(day, s, e) { return { schedule_id: 'S' + day, day_of_week: day, start_time: s, end_time: e, effective_from: '', effective_to: '', unit: '*', active: 'Y' }; }
  var sch = [mk(1, '08:15', '16:30'), mk(2, '08:15', '16:30'), mk(3, '08:15', '16:30'), mk(4, '08:15', '16:30'), mk(5, '08:15', '17:00')];
  var emp = { employee_id: 'E1', employee_number: '1', full_name: 'Uji', unit: 'A', created_at: '2026-01-01 00:00:00' };
  function ctx(tx, cal, leaves, rules) {
    return { rules: rules || APP.DEFAULT_RULES, cal: { schedules: sch, cal: cal || {} }, tx: tx || {}, leaves: leaves || [], today: '2026-10-30', nowSec: 0 };
  }
  var MON = '2026-10-12', FRI = '2026-10-16', SAT = '2026-10-17';
  function t(d, hm) { return d + ' ' + hm + ':00'; }
  function tx(d, i, o) { var x = {}; x['E1|' + d] = { in: i ? t(d, i) : '', out: o ? t(d, o) : '' }; return x; }

  eq('hari Senin 2026-10-12', U.dow(MON), 1);
  eq('TC-11 libur nasional → Rp0', Calc.day(emp, MON, ctx({}, (function () { var c = {}; c[MON] = { day_type: 'LIBUR_NASIONAL', title: 'Libur' }; return c; })())).total_amount, 0);
  eq('Sabtu libur default', Calc.day(emp, SAT, ctx({})).status, 'LIBUR');
  var f = Calc.day(emp, FRI, ctx(tx(FRI, '08:00', '16:45')));
  eq('TC-12 Jumat pulang 16:45 → pulang cepat (jadwal 17:00)', f.early_leave_amount, 10000);
  eq('TC-12 Jumat pulang 17:00 → normal', Calc.day(emp, FRI, ctx(tx(FRI, '08:00', '17:00'))).total_amount, 0);
  eq('Senin pulang 16:30 → normal', Calc.day(emp, MON, ctx(tx(MON, '08:10', '16:30'))).total_amount, 0);
  eq('TC-13 tidak masuk & pulang → 20.000', Calc.day(emp, MON, ctx({})).total_amount, 20000);
  eq('TC-14 tidak masuk saja → 10.000', Calc.day(emp, MON, ctx(tx(MON, '', '16:30'))).missing_in_amount, 10000);
  eq('TC-15 tidak pulang saja → 10.000', Calc.day(emp, MON, ctx(tx(MON, '08:00', ''))).missing_out_amount, 10000);
  eq('TC-16 terlambat tepat 60 mnt → 7.500', Calc.day(emp, MON, ctx(tx(MON, '09:15', '16:30'))).late_amount, 7500);
  eq('TC-17 terlambat 61 mnt → 10.000', Calc.day(emp, MON, ctx(tx(MON, '09:16', '16:30'))).late_amount, 10000);
  eq('masuk 08:15:00 tidak terlambat', Calc.day(emp, MON, ctx(tx(MON, '08:15', '16:30'))).late_amount, 0);
  eq('masuk 08:16 → terlambat 7.500', Calc.day(emp, MON, ctx(tx(MON, '08:16', '16:30'))).late_amount, 7500);
  eq('terlambat + pulang cepat = 17.500', Calc.day(emp, MON, ctx(tx(MON, '08:30', '16:00'))).total_amount, 17500);
  var lv = [{ employee_id: 'E1', leave_type: 'SAKIT', start_date: MON, end_date: MON, status: 'Disetujui' }];
  eq('TC-19 izin/sakit disetujui → Rp0', Calc.day(emp, MON, ctx({}, {}, lv)).total_amount, 0);
  var r2 = JSON.parse(JSON.stringify(APP.DEFAULT_RULES)); r2.leaveExempt = false;
  eq('kebijakan izin tidak membebaskan → tetap dipotong', Calc.day(emp, MON, ctx({}, {}, lv, r2)).total_amount, 20000);
  var sp = {}; sp[SAT] = { day_type: 'HARI_KERJA_KHUSUS', title: 'Khusus' };
  eq('hari kerja khusus Sabtu tanpa absen → 20.000', Calc.day(emp, SAT, ctx({}, sp)).total_amount, 20000);
  var c3 = ctx({}); c3.today = MON; c3.nowSec = 9 * 3600;
  eq('hari ini sebelum jam pulang: belum dihitung mangkir', Calc.day(emp, MON, c3).total_amount, 0);
  eq('tanggal sebelum terdaftar tidak dipotong', Calc.day(emp, '2025-12-01', ctx({})).status, 'BELUM_TERDAFTAR');

  var d = U.haversine(0, 0, 0, 0.001);
  eq('haversine ±111 m per 0,001° bujur khatulistiwa', d > 111 && d < 111.4, true);
  eq('haversine titik sama = 0', U.haversine(-3.8, 102.26, -3.8, 102.26), 0);
  eq('CSV formula injection dinetralkan', U.csvCell('=HYPERLINK("x")').charAt(0) === '"' && U.csvCell('=1+1').indexOf("'=1+1") === 0, true);
  eq('rupiah format', U.rupiah(7500), 'Rp7.500');

  var msg = out.join('\n') + '\n\n' + (fail ? fail + ' uji GAGAL' : 'Semua uji logika LULUS (' + out.length + ')');
  console.log(msg);
  return msg;
}
