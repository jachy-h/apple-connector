/* Fixed, scoped M0 probe. It creates, rereads and removes one simple event in a named test calendar. */
ObjC.import('Foundation');

function reply(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null,
    operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' };
  return JSON.stringify(output);
}
function input() {
  var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
}
function run() {
  var request;
  try {
    request = input();
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.calendarCrud' ||
      typeof request.requestId !== 'string' || !request.payload || typeof request.payload.calendarName !== 'string' ||
      request.payload.calendarName.length < 1 || request.payload.calendarName.length > 256) throw new Error('Invalid envelope');
    var app = Application('Calendar');
    var calendars = app.calendars.whose({ name: request.payload.calendarName })();
    if (calendars.length !== 1) return reply(request, false, null, 'unsupported_operation');
    var calendar = calendars[0];
    var title = 'Apple Connector M0 Probe ' + request.requestId;
    var start = new Date(Date.now() + 3 * 60 * 60 * 1000);
    var end = new Date(start.getTime() + 15 * 60 * 1000);
    var event = app.Event({ summary: title, startDate: start, endDate: end,
      description: 'Connector-generated M0 validation object; safe to remove.' });
    calendar.events.push(event);
    // Calendar's `uid` getter raises AppleEvent -10000 for this macOS build. Query the
    // uniquely generated title through the already-scoped calendar instead; the title is
    // a UUID-bearing probe value and never comes from user content.
    var reread = calendar.events.whose({ summary: title })();
    if (reread.length !== 1 || reread[0].summary() !== title ||
        !(reread[0].startDate() instanceof Date) || !(reread[0].endDate() instanceof Date) ||
        reread[0].endDate().getTime() <= reread[0].startDate().getTime()) {
      return reply(request, false, null, 'service_unavailable');
    }
    app.delete(reread[0]);
    if (calendar.events.whose({ summary: title })().length !== 0) return reply(request, false, null, 'service_unavailable');
    return reply(request, true, { calendarName: request.payload.calendarName, createdAndRemoved: true });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
