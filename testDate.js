const { normalizeDate } = require("./utils/dateNormalizer");

const testCases = [
  "Today",
  "Yesterday",
  "2 days ago",
  "3 hours ago",
  "Last week",
  "2 weeks ago",
  "Last month",
  "Jul 15",
  "July 15",
  "15 Jul",
  "15 July",
  "Jul 15, 2026",
  "July 15, 2026",
  "2026-07-15",
  "2026/07/15",
  "15/07/2026",
  "15-07-2026",
  "Just now",
  "Moments ago",
  "Invalid format",
  null,
  undefined
];

testCases.forEach(c => {
    const res = normalizeDate(c);
    console.log(`${c} => ${res ? res.toISOString() : 'null'}`);
});
