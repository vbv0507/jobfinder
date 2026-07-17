const TrainingDataset = require('../models/TrainingDataset');

const buildFilter = (options = {}) => {
  const query = {};
  if (options.startDate || options.endDate) {
    query.createdAt = {};
    if (options.startDate) query.createdAt.$gte = new Date(options.startDate);
    if (options.endDate) query.createdAt.$lte = new Date(options.endDate);
  }
  if (options.provider) {
    query['aiEvaluation.providerUsed'] = options.provider;
  }
  if (options.recommendation) {
    query['aiEvaluation.recommendation'] = options.recommendation;
  }
  return query;
};

const exportJSON = async (options = {}) => {
  const query = buildFilter(options);
  const data = await TrainingDataset.find(query).lean();
  return data;
};

const exportCSV = async (options = {}) => {
  const query = buildFilter(options);
  const data = await TrainingDataset.find(query).lean();
  
  if (data.length === 0) return "";
  
  const flatten = (obj, prefix = '') => {
    let result = {};
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key]) && !(obj[key] instanceof Date) && key !== '_id') {
        Object.assign(result, flatten(obj[key], `${prefix}${key}_`));
      } else {
        result[`${prefix}${key}`] = obj[key];
      }
    }
    return result;
  };

  const flattenedData = data.map(d => flatten(d));
  const headers = Array.from(new Set(flattenedData.flatMap(Object.keys)));
  
  const csvRows = [headers.join(',')];
  for (const row of flattenedData) {
    const values = headers.map(header => {
      const val = row[header];
      if (val === null || val === undefined) return '';
      const strVal = String(val).replace(/"/g, '""');
      return `"${strVal}"`;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
};

module.exports = {
  exportJSON,
  exportCSV
};
