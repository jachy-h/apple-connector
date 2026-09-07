/* EventKit-backed, scoped Reminders reader. Apple Events `list.reminders()` can block while
 * iCloud reconciles a list; EventKit performs the fetch asynchronously without enumerating
 * other lists. */
ObjC.import('Foundation');
ObjC.import('EventKit');
function reply(request, ok, result, code) { var output = { protocolVersion: 1, requestId: request ? request.requestId : null, operation: request ? request.operation : null, ok: ok }; if (ok) output.result = result; else output.error = { code: code || 'service_unavailable' }; return JSON.stringify(output); }
function input() { var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding))); }
function text(value, limit) { value = value === null || value === undefined ? '' : String(value); return value.length <= limit ? value : value.slice(0, limit); }
function due(reminder) { try { var components = reminder.dueDateComponents; if (!components) return null; var date = $.NSCalendar.currentCalendar.dateFromComponents(components); return date ? ObjC.unwrap(date).toISOString() : null; } catch (error) { return null; } }
function run() {
  var request;
  try {
    request = input(); var payload = request.payload;
    if (request.protocolVersion !== 1 || request.operation !== 'reminders.listEventKit' || typeof request.requestId !== 'string' || !payload || typeof payload.listId !== 'string' || payload.listId.length < 1 || payload.listId.length > 512 || !Number.isInteger(payload.offset) || payload.offset < 0 || !Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 100) throw new Error('Invalid envelope');
    var store = $.EKEventStore.alloc.init; var calendars = store.calendarsForEntityType($.EKEntityTypeReminder); var calendar = null;
    for (var i = 0; i < calendars.count; i++) if (ObjC.unwrap(calendars.objectAtIndex(i).calendarIdentifier) === payload.listId) { calendar = calendars.objectAtIndex(i); break; }
    if (!calendar) return reply(request, false, null, 'unsupported_operation');
    var completed = false, reminders = null;
    var predicate = store.predicateForRemindersInCalendars($.NSArray.arrayWithObject(calendar));
    store.fetchRemindersMatchingPredicateCompletion(predicate, function(value) { reminders = value; completed = true; });
    var deadline = Date.now() + 20_000;
    while (!completed && Date.now() < deadline) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
    if (!completed || !reminders) return reply(request, false, null, 'timeout');
    var all = [];
    for (var j = 0; j < reminders.count; j++) { var item = reminders.objectAtIndex(j); all.push({ id: text(ObjC.unwrap(item.calendarItemIdentifier), 512), listId: payload.listId, title: text(ObjC.unwrap(item.title), 500), body: text(ObjC.unwrap(item.notes), 32000), completed: Boolean(item.isCompleted), due: due(item) }); }
    all.sort(function(a, b) { return a.title < b.title ? -1 : a.title > b.title ? 1 : 0; });
    var end = Math.min(all.length, payload.offset + payload.limit);
    return reply(request, true, { items: all.slice(payload.offset, end), nextOffset: end < all.length ? end : null });
  } catch (error) { return reply(request, false, null, 'service_unavailable'); }
}
