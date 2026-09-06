/* Fixed Notes writer. Plaintext is escaped before being placed in the simple-note HTML shell. */
ObjC.import('Foundation');
function reply(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null,
    operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' };
  return JSON.stringify(output);
}
function requestFromStdin() {
  var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
}
function simpleChange(change) {
  return change && typeof change.containerId === 'string' && change.containerId.length > 0 && change.containerId.length <= 512 &&
    typeof change.title === 'string' && change.title.length > 0 && change.title.length <= 500 &&
    typeof change.body === 'string' && change.body.length <= 32000;
}
function folderFor(app, id) {
  var folders = app.folders.whose({ id: id })();
  return folders.length === 1 && !folders[0].shared() ? folders[0] : null;
}
function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function htmlFor(change) {
  return '<h1>' + escapeHtml(change.title) + '</h1><div>' + escapeHtml(change.body).replace(/\n/g, '<br>') + '</div>';
}
function run() {
  var request;
  try {
    request = requestFromStdin();
    if (request.protocolVersion !== 1 || typeof request.requestId !== 'string' || !request.payload) throw new Error('Invalid envelope');
    var app = Application('Notes');
    if (request.operation === 'notes.preflight') {
      if (typeof request.payload.containerId !== 'string' || !folderFor(app, request.payload.containerId)) return reply(request, false, null, 'unsupported_operation');
      return reply(request, true, {});
    }
    if (request.operation === 'notes.create') {
      var change = request.payload.change;
      if (!simpleChange(change)) return reply(request, false, null, 'unsupported_operation');
      var folder = folderFor(app, change.containerId);
      if (!folder) return reply(request, false, null, 'unsupported_operation');
      var note = app.Note({ body: htmlFor(change) });
      folder.notes.push(note);
      return reply(request, true, { id: note.id(), containerId: change.containerId });
    }
    if (request.operation === 'notes.verify') {
      var receipt = request.payload.receipt;
      var expected = request.payload.expected;
      if (!receipt || typeof receipt.id !== 'string' || !simpleChange(expected) || receipt.containerId !== expected.containerId) {
        return reply(request, false, null, 'unsupported_operation');
      }
      var verifyFolder = folderFor(app, expected.containerId);
      if (!verifyFolder) return reply(request, false, null, 'unsupported_operation');
      var matches = verifyFolder.notes.whose({ id: receipt.id })();
      var verified = matches.length === 1 && matches[0].name() === expected.title && matches[0].container().id() === expected.containerId &&
        !matches[0].shared() && !matches[0].passwordProtected();
      return reply(request, true, { verified: verified });
    }
    return reply(request, false, null, 'unsupported_operation');
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
