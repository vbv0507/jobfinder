const express = require("express");

const {
    getActiveProfile,
    upsertProfile,
} = require("../controller/profileController");

const router = express.Router();


router.get("/", getActiveProfile);


router.post("/", upsertProfile);

module.exports = router;
