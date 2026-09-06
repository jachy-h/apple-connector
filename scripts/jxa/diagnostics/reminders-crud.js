/* Fixed, scoped M0 probe. Creates, rereads and removes one labelled reminder in the supplied list. */
ObjC.import('Foundation');

function response(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null,
    operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result;
  else output.error = { code: code || 'service_unavailable' };
  return JSON.stringify(output);
}

function readRequest() {
  var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
}

function run() {
  var request;
  var created;
  try {
    request = readRequest();
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.remindersCrud' ||
        typeof request.requestId !== 'string' || !request.payload ||
        typeof request.payload.containerId !== 'string' || request.payload.containerId.length < 1 ||
        request.payload.containerId.length > 512) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    var matches = app.lists.whose({ id: request.payload.containerId })();
    if (matches.length !== 1) return response(request, false, null, 'unsupported_operation');
    var list = matches[0];
    var title = 'Apple Connector M0 Probe ' + request.requestId;
    created = app.Reminder({ name: title, body: 'Connector-generated M0 validation object; safe to remove.' });
    list.reminders.push(created);
    var id = created.id();
    // Query through the already-scoped list. The app-wide reminder collection can block while
    // Reminders reconciles iCloud state, and would also exceed this probe's intended scope.
    var reread = list.reminders.whose({ id: id })();
    if (reread.length !== 1 || reread[0].name() !== title || reread[0].container().id() !== request.payload.containerId) {
      return response(request, false, null, 'service_unavailable');
    }
    app.delete(reread[0]);
    if (list.reminders.whose({ id: id })().length !== 0) return response(request, false, null, 'service_unavailable');
    return response(request, true, { containerId: request.payload.containerId, createdAndRemoved: true });
  } catch (error) {
    // Avoid sending application exception text or user data across the process boundary.
    return response(request, false, null, 'service_unavailable');
  }
}
