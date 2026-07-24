class ScraperError extends Error {
  constructor(type, message, details = {}) {
    super(message);
    this.name = 'ScraperError';
    this.type = type;
    this.details = details;
  }
}

const ErrorTypes = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  NOT_FOUND: '404',
  FORBIDDEN: '403',
  RATE_LIMITED: '429',
  PARSER_ERROR: 'PARSER_ERROR',
  ATS_CHANGED: 'ATS_CHANGED',
  INVALID_ENDPOINT: 'INVALID_ENDPOINT',
  BLOCKED: 'BLOCKED',
  PARSER_OUTDATED: 'PARSER_OUTDATED',
  EMPTY_JOBS: 'EMPTY_JOBS',
  API_FAILURE: 'API_FAILURE',
  UNKNOWN: 'UNKNOWN'
};

module.exports = { ScraperError, ErrorTypes };
