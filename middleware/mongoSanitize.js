// Custom MongoDB Sanitization for Express 5
// Express 5 makes req.query a getter, so we must mutate the object in-place
// instead of re-assigning it.

const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) return;
    
    for (const key of Object.keys(obj)) {
        if (key.startsWith('$')) {
            delete obj[key];
        } else {
            sanitizeObject(obj[key]);
        }
    }
};

const mongoSanitize = () => {
    return (req, res, next) => {
        if (req.body) sanitizeObject(req.body);
        if (req.query) sanitizeObject(req.query);
        if (req.params) sanitizeObject(req.params);
        next();
    };
};

module.exports = mongoSanitize;
