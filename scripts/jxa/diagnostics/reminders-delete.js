/* Fixed cleanup primitive for a caller-created M0 probe reminder; both list and reminder IDs must match. */
ObjC.import('Foundation');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function run() {
  var request;
  try {
    var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.remindersDeleteProbe' || typeof request.requestId !== 'string' || !request.payload || typeof request.payload.listId !== 'string' || typeof request.payload.id !== 'string') throw new Error('Invalid envelope');
    var app = Application('Reminders'); var lists = app.lists.whose({ id: request.payload.listId })(); if (lists.length !== 1) return reply(request, false, null, 'unsupported_operation');
    var matches = lists[0].reminders.whose({ id: request.payload.id })(); if (matches.length !== 1) return reply(request, false, null, 'unsupported_operation');
    app.delete(matches[0]); if (lists[0].reminders.whose({ id: request.payload.id })().length !== 0) return reply(request, false, null, 'service_unavailable');
    return reply(request, true, { removed: true });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
