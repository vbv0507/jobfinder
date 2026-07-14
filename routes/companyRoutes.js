const express = require("express");

const {
    addCompany,
    getCompanies,
    seedCompanyList,
} = require("../controller/companyController");

const router = express.Router();


router.post("/seed", seedCompanyList);


router.post("/", addCompany);


router.get("/", getCompanies);

module.exports = router;
