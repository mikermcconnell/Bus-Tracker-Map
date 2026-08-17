const DEPARTURE_STOP_GROUPS = Object.freeze({
  'downtown-barrie': Object.freeze({
    id: 'downtown-barrie',
    name: 'Downtown Barrie',
    stops: Object.freeze([
      Object.freeze({ code: '1', label: 'STOP 1' }),
      Object.freeze({ code: '2', label: 'STOP 2' }),
    ]),
  }),
  'barrie-allandale': Object.freeze({
    id: 'barrie-allandale',
    name: 'Barrie Allandale Transit Terminal',
    stops: Object.freeze([
      Object.freeze({ code: '9001', label: 'PLATFORM 1', optional: true }),
      Object.freeze({ code: '9002', label: 'PLATFORM 2', optional: true }),
      Object.freeze({ code: '9003', label: 'PLATFORM 3' }),
      Object.freeze({ code: '9004', label: 'PLATFORM 4' }),
      Object.freeze({ code: '9005', label: 'PLATFORM 5' }),
      Object.freeze({ code: '9006', label: 'PLATFORM 6' }),
      Object.freeze({ code: '9007', label: 'PLATFORM 7', optional: true }),
      Object.freeze({ code: '9008', label: 'PLATFORM 8', optional: true }),
      Object.freeze({ code: '9009', label: 'PLATFORM 9', optional: true }),
      Object.freeze({ code: '9010', label: 'PLATFORM 10', optional: true }),
      Object.freeze({ code: '9011', label: 'PLATFORM 11', optional: true }),
      Object.freeze({ code: '9012', label: 'PLATFORM 12' }),
      Object.freeze({ code: '9013', label: 'PLATFORM 13' }),
      Object.freeze({ code: '14', label: 'STOP 14' }),
    ]),
  }),
});

module.exports = { DEPARTURE_STOP_GROUPS };
