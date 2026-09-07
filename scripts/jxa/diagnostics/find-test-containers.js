/* Fixed metadata-only discovery for an explicitly named Reminders list. It never opens items. */
ObjC.import('Foundation');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function input() { var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding))); }
function run() {
  var request;
  try {
    request = input(); var name = request.payload && request.payload.name;
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.findTestContainers' || typeof request.requestId !== 'string' || typeof name !== 'string' || name.length < 1 || name.length > 500) throw new Error('Invalid envelope');
    var reminders = Application('Reminders');
    var lists = reminders.lists.whose({ name: name })();
    return reply(request, true, {
      query: name,
      reminderLists: lists.map(function(list) { return { id: list.id(), name: list.name() }; }),
      // Kept as an empty legacy field so old management clients can parse this metadata-only response.
      noteFolders: [],
      personalDataRead: false,
    });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
