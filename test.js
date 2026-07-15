const mongoose = require("mongoose");

const uri = process.env.MONGO_URI || "mongodb+srv://vbv:1407@cluster0.a3dyf0o.mongodb.net/?appName=Cluster0";

(async () => {
    try {
        console.log("Connecting...");
        await mongoose.connect(uri);

        console.log("Connected!");
        process.exit(0);
    } catch (err) {
        console.error(err);
        console.error(err.stack);
        process.exit(1);
    }
})();