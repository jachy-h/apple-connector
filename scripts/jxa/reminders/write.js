/* Fixed reminders write adapter. Input is structured JSON; no user data becomes script source. */
ObjC.import('Foundation');

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
function validChange(change) {
  return change && typeof change.containerId === 'string' && change.containerId.length > 0 && change.containerId.length <= 512 &&
    typeof change.title === 'string' && change.title.length > 0 && change.title.length <= 500 &&
    typeof change.body === 'string' && change.body.length <= 32000;
}
function listFor(app, id) {
  var lists = app.lists.whose({ id: id })();
  return lists.length === 1 ? lists[0] : null;
}
function dueDate(change) {
  if (!change.due) return null;
  if (change.due.kind === 'date' && typeof change.due.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(change.due.date)) {
    var pieces = change.due.date.split('-');
    return { allDay: new Date(Number(pieces[0]), Number(pieces[1]) - 1, Number(pieces[2])), timed: null };
  }
  if (change.due.kind === 'instant' && typeof change.due.at === 'string') {
    var date = new Date(change.due.at);
    if (!isNaN(date.getTime())) return { allDay: null, timed: date };
  }
  throw new Error('Invalid due date');
}
function run() {
  var request;
  try {
    request = readRequest();
    if (request.protocolVersion !== 1 || typeof request.requestId !== 'string' || !request.payload) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    if (request.operation === 'reminders.preflight') {
      if (typeof request.payload.containerId !== 'string' || !listFor(app, request.payload.containerId)) return reply(request, false, null, 'unsupported_operation');
      return reply(request, true, {});
    }
    if (request.operation === 'reminders.create') {
      var change = request.payload.change;
      if (!validChange(change)) return reply(request, false, null, 'unsupported_operation');
      var list = listFor(app, change.containerId);
      if (!list) return reply(request, false, null, 'unsupported_operation');
      var reminder = app.Reminder({ name: change.title, body: change.body });
      var due = dueDate(change);
      if (due) {
        if (due.allDay) reminder.alldayDueDate = due.allDay;
        else reminder.dueDate = due.timed;
      }
      list.reminders.push(reminder);
      return reply(request, true, { id: reminder.id(), containerId: change.containerId });
    }
    if (request.operation === 'reminders.verify') {
      var receipt = request.payload.receipt;
      var expected = request.payload.expected;
      if (!receipt || typeof receipt.id !== 'string' || !validChange(expected) || receipt.containerId !== expected.containerId) {
        return reply(request, false, null, 'unsupported_operation');
      }
      var verifyList = listFor(app, expected.containerId);
      if (!verifyList) return reply(request, false, null, 'unsupported_operation');
      var matches = verifyList.reminders.whose({ id: receipt.id })();
      var matchesExpected = matches.length === 1 && matches[0].name() === expected.title && matches[0].body() === expected.body &&
        matches[0].container().id() === expected.containerId && !matches[0].completed();
      return reply(request, true, { verified: matchesExpected });
    }
    return reply(request, false, null, 'unsupported_operation');
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
