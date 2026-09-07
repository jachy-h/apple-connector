/* Recovery-only deletion of one M0 probe identified by a caller-held UUID. */
ObjC.import('Foundation');
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
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.remindersDeleteM0ProbeByUuid' ||
        typeof request.requestId !== 'string' || !request.payload || typeof request.payload.containerId !== 'string' ||
        request.payload.containerId.length < 1 || request.payload.containerId.length > 512 ||
        typeof request.payload.probeId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.payload.probeId)) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    var lists = app.lists.whose({ id: request.payload.containerId })();
    if (lists.length !== 1) return reply(request, false, null, 'unsupported_operation');
    var title = 'Apple Connector M0 Probe ' + request.payload.probeId;
    var matches = lists[0].reminders.whose({ name: title })();
    if (matches.length === 0) return reply(request, true, { status: 'not_found', stableId: null });
    if (matches.length !== 1 || matches[0].container().id() !== request.payload.containerId) return reply(request, true, { status: 'ambiguous', stableId: null });
    var stableId = matches[0].id();
    app.delete(matches[0]);
    if (lists[0].reminders.whose({ id: stableId })().length !== 0) return reply(request, true, { status: 'outcome_unknown', stableId: stableId });
    return reply(request, true, { status: 'removed_verified', stableId: stableId });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
