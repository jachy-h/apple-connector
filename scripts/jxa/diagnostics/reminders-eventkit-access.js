/* Read-only EventKit probe: compare one caller-supplied list ID without returning other calendar metadata. */
ObjC.import('Foundation');
ObjC.import('EventKit');
function reply(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' };
  return JSON.stringify(output);
}
function run() {
  var request;
  try {
    var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.remindersEventKitAccess' ||
        typeof request.requestId !== 'string' || !request.payload || typeof request.payload.containerId !== 'string' ||
        request.payload.containerId.length < 1 || request.payload.containerId.length > 512) throw new Error('Invalid envelope');
    var store = $.EKEventStore.alloc.init;
    var calendars = store.calendarsForEntityType($.EKEntityTypeReminder);
    var matches = [];
    for (var i = 0; i < calendars.count; i++) {
      var calendar = calendars.objectAtIndex(i);
      if (ObjC.unwrap(calendar.calendarIdentifier) === request.payload.containerId) matches.push(calendar);
    }
    if (matches.length !== 1) return reply(request, true, { matches: matches.length });
    return reply(request, true, { matches: 1, allowsContentModifications: Boolean(matches[0].allowsContentModifications) });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
