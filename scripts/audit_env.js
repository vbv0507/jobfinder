require('dotenv').config();
const crypto = require('crypto');
const vars = [
  'TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION',
  'TELEGRAM_GROUP_USERNAME', 'TELEGRAM_TEST_MODE', 'TELEGRAM_TEST_CHANNEL',
  'TELEGRAM_HEALTH_ENABLED', 'TELEGRAM_HEALTH_COMMAND', 'TELEGRAM_HEALTH_ALLOWED_USERS'
];
console.log('=== PHASE 1 & 6: ENVIRONMENT & SESSION AUDIT ===');
for (const v of vars) {
  const val = process.env[v];
  const exists = val !== undefined;
  if (!exists) {
    console.log(v.padEnd(30), '| MISSING');
    continue;
  }
  const len = val.length;
  const first10 = val.substring(0, 10);
  const last10 = val.substring(Math.max(0, len - 10));
  const hasWhitespace = /\s/.test(val);
  const hasNewlines = /[\r\n]/.test(val);
  const hasEscaped = /\\[nrtt\\\'\"]/.test(val);
  const hasQuotes = /[\"\']/.test(val);
  let hash = '';
  if (v === 'TELEGRAM_SESSION') {
      hash = crypto.createHash('sha256').update(val).digest('hex');
  }
  
  console.log(v.padEnd(30), '| length:', String(len).padEnd(4), '| first10:', first10.padEnd(10), '| last10:', last10.padEnd(10), '| WS:', hasWhitespace ? 'YES' : 'NO', '| NL:', hasNewlines ? 'YES' : 'NO', '| Esc:', hasEscaped ? 'YES' : 'NO', '| Quotes:', hasQuotes ? 'YES' : 'NO', hash ? '| SHA256: ' + hash : '');
}
