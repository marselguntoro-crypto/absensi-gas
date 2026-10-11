/**
 * Location.gs — pengelolaan lokasi kantor (geofence). Setiap perubahan diaudit.
 */
var Location = {
  list: function () {
    Auth.requireAdmin();
    return DB.all(APP.SHEETS.LOC).map(function (l) {
      return { location_id: l.location_id, name: l.name, latitude: l.latitude, longitude: l.longitude, radius_m: l.radius_m, max_accuracy_m: l.max_accuracy_m, active: l.active, allowed_units: l.allowed_units, updated_by: l.updated_by, updated_at: l.updated_at };
    });
  },
  save: function (o) {
    var admin = Auth.requireAdmin();
    var name = U.clean(o.name, 100), lat = U.num(o.latitude), lng = U.num(o.longitude), rad = U.num(o.radius_m), acc = U.num(o.max_accuracy_m);
    var active = String(o.active).toUpperCase() === 'N' ? 'N' : 'Y', units = U.clean(o.allowed_units, 300) || '*', reason = U.clean(o.reason, 300);
    if (!name) throw new AppError('VALIDATION', 'Nama lokasi wajib diisi.');
    if (isNaN(lat) || lat < -90 || lat > 90) throw new AppError('VALIDATION', 'Latitude harus angka -90 sampai 90.');
    if (isNaN(lng) || lng < -180 || lng > 180) throw new AppError('VALIDATION', 'Longitude harus angka -180 sampai 180.');
    if (isNaN(rad) || rad < 5 || rad > 5000) throw new AppError('VALIDATION', 'Radius harus 5–5000 meter.');
    if (isNaN(acc) || acc < 5 || acc > 500) throw new AppError('VALIDATION', 'Batas akurasi harus 5–500 meter.');
    if (active === 'Y' && lat === 0 && lng === 0) throw new AppError('VALIDATION', 'Koordinat 0,0 tidak valid untuk lokasi aktif.');
    if (!reason) throw new AppError('VALIDATION', 'Alasan perubahan wajib diisi.');
    var row = { name: name, latitude: lat, longitude: lng, radius_m: rad, max_accuracy_m: acc, active: active, allowed_units: units, updated_by: admin.email, updated_at: U.nowStr() };
    if (o.location_id) {
      var b = DB.find(APP.SHEETS.LOC, 'location_id', o.location_id);
      if (!b) throw new AppError('NOT_FOUND', 'Lokasi tidak ditemukan.');
      DB.update(APP.SHEETS.LOC, 'location_id', o.location_id, row);
      Audit.log('LOCATION_UPDATE', 'LokasiKantor', o.location_id,
        { name: b.name, latitude: b.latitude, longitude: b.longitude, radius_m: b.radius_m, max_accuracy_m: b.max_accuracy_m, active: b.active, allowed_units: b.allowed_units }, row, reason);
    } else {
      row.location_id = U.id('LOC');
      DB.append(APP.SHEETS.LOC, row);
      Audit.log('LOCATION_CREATE', 'LokasiKantor', row.location_id, null, row, reason);
    }
    return Location.list();
  }
};
