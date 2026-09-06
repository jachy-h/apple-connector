/* Fixed JXA entry point. No Apple Events, permission requests or personal-data queries. */
ObjC.import('Foundation');

function run() {
  var request;
  try {
    var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    var input = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding));
    request = JSON.parse(input);
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.probe' ||
        typeof request.requestId !== 'string') throw new Error('Invalid envelope');
    ObjC.import('EventKit');
    var store = $.EKEventStore.alloc.init;
    return JSON.stringify({
      protocolVersion: 1, requestId: request.requestId, operation: request.operation, ok: true,
      result: {
        osVersion: ObjC.unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString),
        eventKitBridge: Boolean(store),
        calendarAuthorization: Number($.EKEventStore.authorizationStatusForEntityType(0)),
        remindersAuthorization: Number($.EKEventStore.authorizationStatusForEntityType(1)),
        // Selector existence is evidence of bridge visibility, not successful execution.
        fullCalendarRequestSelector: Boolean(store.respondsToSelector('requestFullAccessToEventsWithCompletion:')),
        fullRemindersRequestSelector: Boolean(store.respondsToSelector('requestFullAccessToRemindersWithCompletion:')),
        personalDataRead: false, permissionsRequested: false
      }
    });
  } catch (error) {
    return JSON.stringify({
      protocolVersion: 1, requestId: request ? request.requestId : null,
      operation: request ? request.operation : null, ok: false,
      error: { code: 'service_unavailable' }
    });
  }
}
