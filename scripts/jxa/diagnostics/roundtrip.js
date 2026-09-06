/* In-memory EventKit objects only. Never assign a calendar, request access or save. */
ObjC.import('Foundation');
ObjC.import('EventKit');

function run() {
  var request;
  try {
    var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    if (request.protocolVersion !== 1 || request.operation !== 'diagnostics.roundtrip' ||
        typeof request.requestId !== 'string' || typeof request.payload.text !== 'string' ||
        request.payload.text.length > 10000) throw new Error('Invalid request');
    var store = $.EKEventStore.alloc.init;
    var reminder = $.EKReminder.reminderWithEventStore(store);
    reminder.title = $(request.payload.text);
    reminder.notes = $(request.payload.text);
    var date = $.NSDateComponents.alloc.init;
    date.year = 2028;
    date.month = 2;
    date.day = 29;
    reminder.dueDateComponents = date;
    var event = $.EKEvent.eventWithEventStore(store);
    event.title = $(request.payload.text);
    event.allDay = true;
    return JSON.stringify({
      protocolVersion: 1, requestId: request.requestId, operation: request.operation, ok: true,
      result: {
        title: ObjC.unwrap(reminder.title), notes: ObjC.unwrap(reminder.notes),
        due: {
          year: Number(reminder.dueDateComponents.year), month: Number(reminder.dueDateComponents.month),
          day: Number(reminder.dueDateComponents.day),
          hourUnspecified: Number(reminder.dueDateComponents.hour) === Number($.NSDateComponentUndefined)
        },
        eventTitle: ObjC.unwrap(event.title), allDay: Boolean(event.allDay),
        recurring: Boolean(reminder.hasRecurrenceRules),
        personalDataRead: false, permissionsRequested: false, saved: false
      }
    });
  } catch (error) {
    return JSON.stringify({ protocolVersion: 1, requestId: request ? request.requestId : null,
      operation: request ? request.operation : null, ok: false, error: { code: 'service_unavailable' } });
  }
}
