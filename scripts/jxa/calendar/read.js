/* Fixed Calendar reader. Calendar Apple Events does not expose a stable calendar UID here, so an
 * authorized container is an exact calendar name that must resolve to exactly one calendar. */
ObjC.import('Foundation');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function stdinRequest() { var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding))); }
function bounded(value, limit) { value = typeof value === 'string' ? value : ''; return value.length <= limit ? value : value.slice(0, limit); }
function calendarFor(app, name) { var calendars = app.calendars.whose({ name: name })(); return calendars.length === 1 ? calendars[0] : null; }
function allDay(event) { try { return Boolean(event.alldayEvent()); } catch (error) { return false; } }
function shape(event, calendarId) {
  var start = event.startDate(); var end = event.endDate();
  if (!(start instanceof Date) || !(end instanceof Date) || end.getTime() <= start.getTime()) return null;
  return { calendarId: calendarId, title: bounded(event.summary(), 500), start: start.toISOString(), end: end.toISOString(), allDay: allDay(event), location: bounded(event.location(), 2_000), notes: bounded(event.description(), 32_000) };
}
function validIds(ids) { return Array.isArray(ids) && ids.length <= 100 && ids.every(function(id) { return typeof id === 'string' && id.length > 0 && id.length <= 512; }); }
function run() {
  var request;
  try {
    request = stdinRequest(); if (request.protocolVersion !== 1 || typeof request.requestId !== 'string' || !request.payload) throw new Error('Invalid envelope');
    var app = Application('Calendar');
    if (request.operation === 'calendar.listCalendars') {
      var ids = request.payload.containerIds; if (!validIds(ids)) return reply(request, false, null, 'unsupported_operation');
      var result = []; ids.forEach(function(id) { var calendar = calendarFor(app, id); if (calendar) result.push({ id: id, name: bounded(calendar.name(), 500) }); });
      return reply(request, true, result);
    }
    if (request.operation === 'calendar.listEvents') {
      var id = request.payload.calendarId, from = request.payload.from, to = request.payload.to, offset = request.payload.offset, limit = request.payload.limit;
      if (typeof id !== 'string' || id.length < 1 || id.length > 512 || typeof from !== 'string' || typeof to !== 'string' || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) return reply(request, false, null, 'unsupported_operation');
      var fromDate = new Date(from), toDate = new Date(to); if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || toDate.getTime() <= fromDate.getTime()) return reply(request, false, null, 'unsupported_operation');
      var target = calendarFor(app, id); if (!target) return reply(request, false, null, 'unsupported_operation');
      var matches = []; var all = target.events();
      for (var i = 0; i < all.length; i++) { var item = shape(all[i], id); if (item && item.end > fromDate.toISOString() && item.start < toDate.toISOString()) matches.push(item); }
      matches.sort(function(a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
      var end = Math.min(matches.length, offset + limit); return reply(request, true, { items: matches.slice(offset, end), nextOffset: end < matches.length ? end : null });
    }
    return reply(request, false, null, 'unsupported_operation');
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
