const sendServerError = (res, error, options = {}) => {
    const {
        success = false,
        message = error.message,
        errorField = "message",
    } = options;

    return res.status(500).json({ success, [errorField]: message });
};

const sendNotFound = (res, message) =>
    res.status(404).json({ success: false, message });

module.exports = { sendServerError, sendNotFound };
