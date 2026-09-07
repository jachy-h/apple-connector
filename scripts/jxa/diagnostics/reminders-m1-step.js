/* Fixed, phase-bounded M1 probe. Every mutation targets one UUID-labelled reminder by stable ID. */
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
function listFor(app, id) { var lists = app.lists.whose({ id: id })(); return lists.length === 1 ? lists[0] : null; }
function expectedTitles(probeId) {
  var original = 'Apple Connector M1 Probe ' + probeId;
  return { original: original, changed: original + ' updated' };
}
function targetFor(list, containerId, nativeId, probeId) {
  var matches = list.reminders.whose({ id: nativeId })();
  if (matches.length !== 1) return null;
  var reminder = matches[0];
  var titles = expectedTitles(probeId);
  var title = reminder.name();
  if (reminder.container().id() !== containerId || (title !== titles.original && title !== titles.changed)) return null;
  return reminder;
}
function run() {
  var request;
  try {
    request = input();
    var allowed = ['diagnostics.remindersM1Create', 'diagnostics.remindersM1UpdateTitle',
      'diagnostics.remindersM1UpdateBody', 'diagnostics.remindersM1UpdateDue',
      'diagnostics.remindersM1Complete', 'diagnostics.remindersM1Verify'];
    if (request.protocolVersion !== 1 || allowed.indexOf(request.operation) < 0 ||
        typeof request.requestId !== 'string' || !request.payload ||
        typeof request.payload.containerId !== 'string' || request.payload.containerId.length < 1 ||
        request.payload.containerId.length > 512 || !validUuid(request.payload.probeId)) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    var list = listFor(app, request.payload.containerId);
    if (!list) return reply(request, false, null, 'unsupported_operation');
    var titles = expectedTitles(request.payload.probeId);
    if (request.operation === 'diagnostics.remindersM1Create') {
      var existingOriginal = list.reminders.whose({ name: titles.original })();
      var existingChanged = list.reminders.whose({ name: titles.changed })();
      if (existingOriginal.length + existingChanged.length !== 0) return reply(request, false, null, 'unsupported_operation');
      var created = app.Reminder({ name: titles.original, body: 'initial' });
      list.reminders.push(created);
      var createdId = created.id();
      var reread = targetFor(list, request.payload.containerId, createdId, request.payload.probeId);
      if (!reread) return reply(request, false, null, 'service_unavailable');
      return reply(request, true, { stableId: createdId });
    }
    if (typeof request.payload.nativeId !== 'string' || request.payload.nativeId.length < 1 || request.payload.nativeId.length > 512) throw new Error('Invalid native id');
    var reminder = targetFor(list, request.payload.containerId, request.payload.nativeId, request.payload.probeId);
    if (!reminder) return reply(request, false, null, 'unsupported_operation');
    if (request.operation === 'diagnostics.remindersM1UpdateTitle') reminder.name = titles.changed;
    if (request.operation === 'diagnostics.remindersM1UpdateBody') reminder.body = 'Connector-generated M1 validation object; safe to remove.\nUnicode: 中文 😀';
    if (request.operation === 'diagnostics.remindersM1UpdateDue') reminder.alldayDueDate = new Date(2032, 1, 29);
    if (request.operation === 'diagnostics.remindersM1Complete') reminder.completed = true;
    var after = targetFor(list, request.payload.containerId, request.payload.nativeId, request.payload.probeId);
    if (!after) return reply(request, false, null, 'service_unavailable');
    if (request.operation === 'diagnostics.remindersM1UpdateTitle' && after.name() !== titles.changed) return reply(request, false, null, 'service_unavailable');
    if (request.operation === 'diagnostics.remindersM1UpdateBody' && after.body() !== 'Connector-generated M1 validation object; safe to remove.\nUnicode: 中文 😀') return reply(request, false, null, 'service_unavailable');
    if (request.operation === 'diagnostics.remindersM1UpdateDue') {
      var due = after.alldayDueDate();
      if (!(due instanceof Date) || due.getFullYear() !== 2032 || due.getMonth() !== 1 || due.getDate() !== 29) return reply(request, false, null, 'service_unavailable');
    }
    if (request.operation === 'diagnostics.remindersM1Complete' && !after.completed()) return reply(request, false, null, 'service_unavailable');
    if (request.operation === 'diagnostics.remindersM1Verify') {
      var verifiedDue = after.alldayDueDate();
      var verified = after.name() === titles.changed &&
        after.body() === 'Connector-generated M1 validation object; safe to remove.\nUnicode: 中文 😀' &&
        Boolean(after.completed()) && verifiedDue instanceof Date && verifiedDue.getFullYear() === 2032 &&
        verifiedDue.getMonth() === 1 && verifiedDue.getDate() === 29;
      return reply(request, true, { verified: verified });
    }
    return reply(request, true, { stableId: request.payload.nativeId });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
