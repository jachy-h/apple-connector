/* Fixed Notes read adapter. Each operation is scoped to folder IDs supplied by the authorized service. */
ObjC.import('Foundation');
function reply(request, ok, result, code) {
  var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok };
  if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output);
}
function requestFromStdin() { var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding))); }
function folderFor(app, id) { var folders = app.folders.whose({ id: id })(); return folders.length === 1 && !folders[0].shared() ? folders[0] : null; }
function compact(value, max) { return value.length <= max ? value : value.slice(0, max); }
function summary(note, folderId) {
  var body = compact(note.plaintext(), 32000); return { id: note.id(), folderId: folderId, title: compact(note.name(), 500), snippet: compact(body.replace(/\s+/g, ' ').trim(), 2000) };
}
function run() {
  var request;
  try {
    request = requestFromStdin(); if (request.protocolVersion !== 1 || typeof request.requestId !== 'string' || !request.payload) throw new Error('Invalid envelope');
    var app = Application('Notes');
    if (request.operation === 'notes.listFolders') {
      var ids = request.payload.containerIds; if (!Array.isArray(ids) || ids.length > 100 || ids.some(function(id) { return typeof id !== 'string' || id.length < 1 || id.length > 512; })) return reply(request, false, null, 'unsupported_operation');
      var result = []; ids.forEach(function(id) { var folder = folderFor(app, id); if (folder) result.push({ id: id, name: compact(folder.name(), 500) }); }); return reply(request, true, result);
    }
    if (request.operation === 'notes.get') {
      if (typeof request.payload.folderId !== 'string' || typeof request.payload.id !== 'string') return reply(request, false, null, 'unsupported_operation');
      var folder = folderFor(app, request.payload.folderId); if (!folder) return reply(request, false, null, 'unsupported_operation');
      var matches = folder.notes.whose({ id: request.payload.id })(); if (matches.length !== 1 || matches[0].shared() || matches[0].passwordProtected()) return reply(request, false, null, 'unsupported_operation');
      var item = summary(matches[0], request.payload.folderId); item.body = compact(matches[0].plaintext(), 32000); return reply(request, true, item);
    }
    if (request.operation === 'notes.search') {
      if (typeof request.payload.folderId !== 'string' || typeof request.payload.query !== 'string' || request.payload.query.length > 500 || !Number.isInteger(request.payload.limit) || request.payload.limit < 1 || request.payload.limit > 100) return reply(request, false, null, 'unsupported_operation');
      var searchFolder = folderFor(app, request.payload.folderId); if (!searchFolder) return reply(request, false, null, 'unsupported_operation');
      var needle = request.payload.query.toLocaleLowerCase(); var matches = []; var notes = searchFolder.notes();
      for (var i = 0; i < notes.length && matches.length < request.payload.limit; i++) { var note = notes[i]; if (!note.shared() && !note.passwordProtected() && note.name().toLocaleLowerCase().indexOf(needle) !== -1) matches.push(summary(note, request.payload.folderId)); }
      return reply(request, true, matches);
    }
    return reply(request, false, null, 'unsupported_operation');
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
