const WEEKDAY_FIELDS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

function normalizeDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : '';
}

function buildServiceCalendarMetadata(calendarRows = [], exceptionRows = []) {
  const service_calendars = {};
  const service_exceptions = {};

  (Array.isArray(calendarRows) ? calendarRows : []).forEach((row) => {
    const serviceId = String(row && row.service_id || '');
    if (!serviceId) return;
    service_calendars[serviceId] = {
      start_date: normalizeDateKey(row.start_date),
      end_date: normalizeDateKey(row.end_date),
      sunday: String(row.sunday || '0') === '1',
      monday: String(row.monday || '0') === '1',
      tuesday: String(row.tuesday || '0') === '1',
      wednesday: String(row.wednesday || '0') === '1',
      thursday: String(row.thursday || '0') === '1',
      friday: String(row.friday || '0') === '1',
      saturday: String(row.saturday || '0') === '1',
    };
  });

  (Array.isArray(exceptionRows) ? exceptionRows : []).forEach((row) => {
    const serviceId = String(row && row.service_id || '');
    const date = normalizeDateKey(row && row.date);
    const exceptionType = Number(row && row.exception_type);
    if (!serviceId || !date || (exceptionType !== 1 && exceptionType !== 2)) return;
    if (!service_exceptions[date]) service_exceptions[date] = {};
    service_exceptions[date][serviceId] = exceptionType;
  });

  return { service_calendars, service_exceptions };
}

function weekdayForDateKey(dateKey) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return '';
  const date = new Date(Date.UTC(
    Number(normalized.slice(0, 4)),
    Number(normalized.slice(4, 6)) - 1,
    Number(normalized.slice(6, 8))
  ));
  return WEEKDAY_FIELDS[date.getUTCDay()] || '';
}

function isServiceActiveOnDate(metadata, serviceId, dateKey) {
  const normalizedServiceId = String(serviceId || '');
  const normalizedDate = normalizeDateKey(dateKey);
  if (!normalizedDate) return false;

  const calendars = metadata && metadata.service_calendars || {};
  const exceptions = metadata && metadata.service_exceptions || {};
  const exception = exceptions[normalizedDate] && exceptions[normalizedDate][normalizedServiceId];
  if (exception === 1) return true;
  if (exception === 2) return false;

  const calendar = calendars[normalizedServiceId];
  if (!calendar) {
    // Older generated metadata did not preserve service calendars. Keep its
    // assignments usable until the next static-feed rebuild.
    return !Object.keys(calendars).length && !Object.keys(exceptions).length;
  }
  if (calendar.start_date && normalizedDate < calendar.start_date) return false;
  if (calendar.end_date && normalizedDate > calendar.end_date) return false;
  const weekday = weekdayForDateKey(normalizedDate);
  return Boolean(weekday && calendar[weekday]);
}

module.exports = {
  WEEKDAY_FIELDS,
  buildServiceCalendarMetadata,
  isServiceActiveOnDate,
  normalizeDateKey,
  weekdayForDateKey,
};
