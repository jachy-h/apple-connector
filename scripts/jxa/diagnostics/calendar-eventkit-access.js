/* Fixed EventKit metadata probe. It returns only the matching supplied calendar's capability bits. */
ObjC.import('Foundation');
ObjC.import('EventKit');
function reply(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null,
    operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' };
  return JSON.stringify(output);
}
function run() {
  var request;
  try {
    var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.calendarEventKitAccess' ||
      typeof request.requestId !== 'string' || !request.payload || typeof request.payload.calendarName !== 'string') throw new Error('Invalid envelope');
    var store = $.EKEventStore.alloc.init;
    var calendars = store.calendarsForEntityType($.EKEntityTypeEvent);
    var matches = [];
    for (var i = 0; i < calendars.count; i++) {
      var calendar = calendars.objectAtIndex(i);
      if (ObjC.unwrap(calendar.title) === request.payload.calendarName) matches.push(calendar);
    }
    if (matches.length !== 1) return reply(request, true, { matches: matches.length });
    return reply(request, true, { matches: 1, calendarIdentifier: ObjC.unwrap(matches[0].calendarIdentifier),
      allowsContentModifications: Boolean(matches[0].allowsContentModifications) });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
