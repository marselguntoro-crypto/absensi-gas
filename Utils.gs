/**
 * Utils.gs — error aplikasi, tanggal/waktu, geodesi, sanitasi.
 */
function AppError(code, message) {
  this.code = code;
  this.message = message;
  this.isAppError = true;
}

var U = {
  pad2: function (n) { n = String(n); return n.length < 2 ? '0' + n : n; },
  fmt: function (d, p) { return Utilities.formatDate(d, APP.TZ, p); },
  nowStr: function () { return U.fmt(new Date(), 'yyyy-MM-dd HH:mm:ss'); },
  today: function () { return U.fmt(new Date(), 'yyyy-MM-dd'); },
  normEmail: function (s) { return String(s == null ? '' : s).trim().toLowerCase(); },
  isEmail: function (s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254; },
  clean: function (s, max) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return max ? s.substr(0, max) : s;
  },
  isDate: function (s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2], 12);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  },
  _d: function (s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); },
  dow: function (s) { var g = U._d(s).getDay(); return g === 0 ? 7 : g; }, // 1=Senin ... 7=Minggu
  addDays: function (s, n) {
    var p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n, 12);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  },
  daysBetween: function (a, b) { return Math.round((U._d(b) - U._d(a)) / 86400000); },
  range: function (from, to) {
    var out = [], d = from, guard = 0;
    while (d <= to && guard++ < 400) { out.push(d); d = U.addDays(d, 1); }
    return out;
  },
  lastDayOfMonth: function (ym) {
    var p = ym.split('-').map(Number);
    return ym + '-' + U.pad2(new Date(p[0], p[1], 0).getDate());
  },
  hhmm: function (v) {
    if (v instanceof Date) return U.fmt(v, 'HH:mm');
    var m = /^(\d{1,2}):(\d{2})/.exec(String(v == null ? '' : v));
    return m ? U.pad2(m[1]) + ':' + m[2] : '';
  },
  min: function (hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  },
  secOfDay: function (ts) {
    var m = /(\d{2}):(\d{2}):(\d{2})$/.exec(String(ts));
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
  },
  num: function (v) { if (v === '' || v == null) return NaN; var n = Number(v); return isFinite(n) ? n : NaN; },
  haversine: function (lat1, lon1, lat2, lon2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
  id: function (prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').substr(0, 10).toUpperCase(); },
  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },
  rupiah: function (n) { return 'Rp' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); },
  csvCell: function (v) {
    var s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah formula injection
    if (/[",\n\r;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  },
  page: function (arr, page, size) {
    size = Math.min(Math.max(Number(size) || 25, 1), 100);
    var pages = Math.max(Math.ceil(arr.length / size), 1);
    page = Math.min(Math.max(Number(page) || 1, 1), pages);
    return { rows: arr.slice((page - 1) * size, page * size), total: arr.length, page: page, pages: pages };
  },
  dateParam: function (s, label) {
    s = String(s || '').trim();
    if (!U.isDate(s)) throw new AppError('VALIDATION', 'Tanggal ' + (label || '') + ' tidak valid (format yyyy-mm-dd).');
    return s;
  }
};
