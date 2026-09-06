/* Fixed Reminders reader. The service provides explicit authorized list IDs and pagination bounds. */
ObjC.import('Foundation');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function stdinRequest() { var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding))); }
function listFor(app, id) { var lists = app.lists.whose({ id: id })(); return lists.length === 1 ? lists[0] : null; }
function bounded(value, limit) { return value.length <= limit ? value : value.slice(0, limit); }
function dueValue(reminder) { try { var date = reminder.dueDate(); return date ? date.toISOString() : null; } catch (error) { return null; } }
function shape(reminder, listId) { return { id: reminder.id(), listId: listId, title: bounded(reminder.name(), 500), body: bounded(reminder.body(), 32000), completed: Boolean(reminder.completed()), due: dueValue(reminder) }; }
function run() {
  var request;
  try {
    request = stdinRequest(); if (request.protocolVersion !== 1 || typeof request.requestId !== 'string' || !request.payload) throw new Error('Invalid envelope');
    var app = Application('Reminders');
    if (request.operation === 'reminders.listLists') {
      var ids = request.payload.containerIds; if (!Array.isArray(ids) || ids.length > 100 || ids.some(function(id) { return typeof id !== 'string' || id.length < 1 || id.length > 512; })) return reply(request, false, null, 'unsupported_operation');
      var lists = []; ids.forEach(function(id) { var list = listFor(app, id); if (list) lists.push({ id: id, name: bounded(list.name(), 500) }); }); return reply(request, true, lists);
    }
    if (request.operation === 'reminders.list') {
      if (typeof request.payload.listId !== 'string' || !Number.isInteger(request.payload.offset) || request.payload.offset < 0 || !Number.isInteger(request.payload.limit) || request.payload.limit < 1 || request.payload.limit > 100) return reply(request, false, null, 'unsupported_operation');
      var target = listFor(app, request.payload.listId); if (!target) return reply(request, false, null, 'unsupported_operation');
      var all = target.reminders(); var start = request.payload.offset; var end = Math.min(all.length, start + request.payload.limit); var items = [];
      for (var i = start; i < end; i++) items.push(shape(all[i], request.payload.listId));
      return reply(request, true, { items: items, nextOffset: end < all.length ? end : null });
    }
    return reply(request, false, null, 'unsupported_operation');
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
