/* Recovery-only deletion of one M1 probe identified by a caller-held UUID. */
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
function validUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function validOptionalId(value) { return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 512); }
function identity(reminder) {
  try { return { id: reminder.id(), title: reminder.name(), containerId: reminder.container().id() }; }
  catch (error) { return null; }
}
function run() {
  var request;
  try {
    request = input();
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.remindersDeleteM1Probe' ||
        typeof request.requestId !== 'string' || !request.payload || typeof request.payload.containerId !== 'string' ||
        request.payload.containerId.length < 1 || request.payload.containerId.length > 512 || !validUuid(request.payload.probeId) ||
        !validOptionalId(request.payload.nativeId)) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    var lists = app.lists.whose({ id: request.payload.containerId })();
    if (lists.length !== 1) return reply(request, false, null, 'unsupported_operation');
    var originalTitle = 'Apple Connector M1 Probe ' + request.payload.probeId;
    var changedTitle = originalTitle + ' updated';
    var matches = [];
    if (request.payload.nativeId) {
      matches = lists[0].reminders.whose({ id: request.payload.nativeId })();
    } else {
      var originalMatches = lists[0].reminders.whose({ name: originalTitle })();
      var changedMatches = lists[0].reminders.whose({ name: changedTitle })();
      var byId = {};
      originalMatches.concat(changedMatches).forEach(function(reminder) {
        var value = identity(reminder);
        if (value && value.containerId === request.payload.containerId) byId[value.id] = reminder;
      });
      Object.keys(byId).forEach(function(id) { matches.push(byId[id]); });
    }
    if (matches.length === 0) return reply(request, true, { status: 'not_found', stableId: request.payload.nativeId || null });
    if (matches.length !== 1) return reply(request, true, { status: 'ambiguous', stableId: null });
    var found = identity(matches[0]);
    if (!found || found.containerId !== request.payload.containerId ||
        (found.title !== originalTitle && found.title !== changedTitle) ||
        (request.payload.nativeId && found.id !== request.payload.nativeId)) {
      return reply(request, true, { status: 'ambiguous', stableId: null });
    }
    app.delete(matches[0]);
    // A successful delete call is not sufficient evidence; verify absence by stable ID.
    if (lists[0].reminders.whose({ id: found.id })().length !== 0) {
      return reply(request, true, { status: 'outcome_unknown', stableId: found.id });
    }
    return reply(request, true, { status: 'removed_verified', stableId: found.id });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
