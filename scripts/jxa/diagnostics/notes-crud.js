/* Fixed, scoped M0 probe. It creates, rereads and removes one simple note in a caller-specified folder. */
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
function run() {
  var request;
  try {
    request = input();
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.notesCrud' ||
      typeof request.requestId !== 'string' || !request.payload || typeof request.payload.folderId !== 'string' ||
      request.payload.folderId.length < 1 || request.payload.folderId.length > 512) throw new Error('Invalid envelope');
    var app = Application('Notes');
    var folders = app.folders.whose({ id: request.payload.folderId })();
    if (folders.length !== 1 || folders[0].shared()) return reply(request, false, null, 'unsupported_operation');
    var folder = folders[0];
    var title = 'Apple Connector M0 Probe ' + request.requestId;
    var note = app.Note({ body: '<h1>' + title + '</h1><p>Connector-generated M0 validation object; safe to remove.</p>' });
    folder.notes.push(note);
    var id = note.id();
    var reread = folder.notes.whose({ id: id })();
    if (reread.length !== 1 || reread[0].name() !== title || reread[0].container().id() !== request.payload.folderId) {
      return reply(request, false, null, 'service_unavailable');
    }
    app.delete(reread[0]);
    if (folder.notes.whose({ id: id })().length !== 0) return reply(request, false, null, 'service_unavailable');
    return reply(request, true, { folderId: request.payload.folderId, createdAndRemoved: true });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
