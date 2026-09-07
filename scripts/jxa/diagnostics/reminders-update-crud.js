/* Fixed M1 probe. It mutates only a newly-created, UUID-labelled reminder in one supplied list. */
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
function listFor(app, id) {
  var lists = app.lists.whose({ id: id })();
  return lists.length === 1 ? lists[0] : null;
}
function run() {
  var request, list, id;
  try {
    request = input();
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.remindersUpdateCrud' ||
        typeof request.requestId !== 'string' || !request.payload || typeof request.payload.containerId !== 'string' ||
        request.payload.containerId.length < 1 || request.payload.containerId.length > 512 ||
        typeof request.payload.probeId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.payload.probeId)) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    list = listFor(app, request.payload.containerId);
    if (!list) return reply(request, false, null, 'unsupported_operation');
    // probeId is generated and retained by the caller before any mutation, enabling exact recovery
    // if the native process later has an unknown outcome.
    var originalTitle = 'Apple Connector M1 Probe ' + request.payload.probeId;
    var changedTitle = originalTitle + ' updated';
    var changedBody = 'Connector-generated M1 validation object; safe to remove.\nUnicode: 中文 😀';
    var changedDue = new Date(2032, 1, 29);
    var created = app.Reminder({ name: originalTitle, body: 'initial' });
    list.reminders.push(created);
    id = created.id();
    var matches = list.reminders.whose({ id: id })();
    if (matches.length !== 1 || matches[0].container().id() !== request.payload.containerId) return reply(request, false, null, 'service_unavailable');
    matches[0].name = changedTitle;
    matches[0].body = changedBody;
    matches[0].alldayDueDate = changedDue;
    matches[0].completed = true;
    var reread = list.reminders.whose({ id: id })();
    var due = reread.length === 1 ? reread[0].alldayDueDate() : null;
    if (reread.length !== 1 || reread[0].name() !== changedTitle || reread[0].body() !== changedBody ||
        !reread[0].completed() || !(due instanceof Date) || due.getFullYear() !== 2032 || due.getMonth() !== 1 || due.getDate() !== 29) {
      return reply(request, false, null, 'service_unavailable');
    }
    app.delete(reread[0]);
    if (list.reminders.whose({ id: id })().length !== 0) return reply(request, false, null, 'service_unavailable');
    return reply(request, true, { containerId: request.payload.containerId, updatedCompletedAndRemoved: true });
  } catch (error) {
    // Do not return native errors: they may include private reminder content.
    return reply(request, false, null, 'service_unavailable');
  }
}
