/* Fixed cleanup primitive for a caller-created M0 probe note. The ID and folder must both match. */
ObjC.import('Foundation');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function run() {
  var request;
  try {
    var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.notesDeleteProbe' || typeof request.requestId !== 'string' || !request.payload || typeof request.payload.folderId !== 'string' || typeof request.payload.id !== 'string') throw new Error('Invalid envelope');
    var app = Application('Notes'); var folders = app.folders.whose({ id: request.payload.folderId })(); if (folders.length !== 1) return reply(request, false, null, 'unsupported_operation');
    var matches = folders[0].notes.whose({ id: request.payload.id })(); if (matches.length !== 1) return reply(request, false, null, 'unsupported_operation');
    app.delete(matches[0]); if (folders[0].notes.whose({ id: request.payload.id })().length !== 0) return reply(request, false, null, 'service_unavailable');
    return reply(request, true, { removed: true });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
