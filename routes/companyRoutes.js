const express = require("express");

const {
    addCompany,
    getCompanies,
    seedCompanyList,
} = require("../controller/companyController");

const router = express.Router();

// POST /api/companies/seed -> reset MongoDB companies from utils/companies.js
router.post("/seed", seedCompanyList);

// POST /api/companies -> add one company manually
router.post("/", addCompany);

// GET /api/companies -> view all companies
router.get("/", getCompanies);

module.exports = router;
