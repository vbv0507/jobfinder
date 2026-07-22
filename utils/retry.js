const withRetry = async (fn, options = {}) => {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    jitter = true,
  } = options;

  let attempt = 0;
  
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      
      const status = error.response?.status || error.status;
      
      // Do NOT retry these HTTP statuses (permanent failures)
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        throw error;
      }

      if (attempt > maxRetries) {
        throw error;
      }

      // Exponential backoff calculation
      let delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      
      if (jitter) {
        delay = delay * (0.5 + Math.random());
      }
      
      console.log(`[Retry] Attempt ${attempt} failed. Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

module.exports = { withRetry };
