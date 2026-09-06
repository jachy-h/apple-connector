/* Fixed metadata-only discovery for an explicitly named test container. It never opens a list's
 * reminders or a folder's notes; results are names, IDs, sharing state and match counts only. */
ObjC.import('Foundation');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function input() { var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding))); }
function safeShared(folder) { try { return Boolean(folder.shared()); } catch (error) { return null; } }
function run() {
  var request;
  try {
    request = input(); var name = request.payload && request.payload.name;
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.findTestContainers' || typeof request.requestId !== 'string' || typeof name !== 'string' || name.length < 1 || name.length > 500) throw new Error('Invalid envelope');
    var reminders = Application('Reminders'), notes = Application('Notes');
    var lists = reminders.lists.whose({ name: name })(), folders = notes.folders.whose({ name: name })();
    return reply(request, true, {
      query: name,
      reminderLists: lists.map(function(list) { return { id: list.id(), name: list.name() }; }),
      noteFolders: folders.map(function(folder) { return { id: folder.id(), name: folder.name(), shared: safeShared(folder) }; }),
      personalDataRead: false,
    });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
