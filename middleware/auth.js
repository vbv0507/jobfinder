const requireAdmin = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query['x-api-key'];
    if (!key || key !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ success: false, message: "Unauthorized: Invalid or missing x-api-key" });
    }
    next();
};

module.exports = { requireAdmin };
