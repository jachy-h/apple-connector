/* Fixed EventKit probe: one named calendar, one generated event, stable ID reread, then removal. */
ObjC.import('Foundation');
ObjC.import('EventKit');

function reply(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null,
    operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' };
  return JSON.stringify(output);
}
function readRequest() {
  var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
}
function errorPointer() { return Ref(); }
function run() {
  var request;
  var store;
  var identifier;
  try {
    request = readRequest();
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.calendarEventKitCrud' ||
      typeof request.requestId !== 'string' || !request.payload || typeof request.payload.calendarName !== 'string' ||
      request.payload.calendarName.length < 1 || request.payload.calendarName.length > 256) throw new Error('Invalid envelope');
    store = $.EKEventStore.alloc.init;
    var calendars = store.calendarsForEntityType($.EKEntityTypeEvent);
    var matches = [];
    for (var i = 0; i < calendars.count; i++) {
      var calendar = calendars.objectAtIndex(i);
      if (ObjC.unwrap(calendar.title) === request.payload.calendarName) matches.push(calendar);
    }
    if (matches.length !== 1 || !matches[0].allowsContentModifications) return reply(request, false, null, 'unsupported_operation');
    var title = 'Apple Connector EventKit M0 Probe ' + request.requestId;
    var event = $.EKEvent.eventWithEventStore(store);
    event.calendar = matches[0];
    event.title = $(title);
    event.startDate = $.NSDate.dateWithTimeIntervalSinceNow(3 * 60 * 60);
    event.endDate = $.NSDate.dateWithTimeIntervalSinceDate(15 * 60, event.startDate);
    var saveError = errorPointer();
    if (!store.saveEventSpanCommitError(event, $.EKSpanThisEvent, true, saveError)) return reply(request, false, null, 'service_unavailable');
    identifier = ObjC.unwrap(event.eventIdentifier);
    if (!identifier) return reply(request, false, null, 'service_unavailable');
    var reread = store.eventWithIdentifier(identifier);
    if (!reread || ObjC.unwrap(reread.title) !== title || ObjC.unwrap(reread.calendar.calendarIdentifier) !== ObjC.unwrap(matches[0].calendarIdentifier)) {
      return reply(request, false, null, 'service_unavailable');
    }
    var removeError = errorPointer();
    if (!store.removeEventSpanCommitError(reread, $.EKSpanThisEvent, true, removeError)) return reply(request, false, null, 'service_unavailable');
    if (store.eventWithIdentifier(identifier)) return reply(request, false, null, 'service_unavailable');
    return reply(request, true, { calendarIdentifier: ObjC.unwrap(matches[0].calendarIdentifier), stableEventIdentifier: true, createdAndRemoved: true });
  } catch (error) {
    // Native exception details may include application state; keep the process protocol private.
    return reply(request, false, null, 'service_unavailable');
  }
}
