const mongoose = require('mongoose');

const uri = "mongodb://vbv:1407@ac-3ldggxj-shard-00-00.a3dyf0o.mongodb.net:27017,ac-3ldggxj-shard-00-01.a3dyf0o.mongodb.net:27017,ac-3ldggxj-shard-00-02.a3dyf0o.mongodb.net:27017/jobfinder?ssl=true&replicaSet=atlas-gfiex6-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0";

console.log("Attempting to connect to MongoDB...");
mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log("Successfully connected to MongoDB!");
    process.exit(0);
  })
  .catch(err => {
    console.error("MongoDB Connection Error:");
    console.error(err);
    process.exit(1);
  });
