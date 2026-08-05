const express = require("express");

const {
    addCompany,
    getCompanies,
    seedCompanyList,
} = require("../controllers/companyController");

const router = express.Router();


const { requireAdmin, requireExtendedViewer } = require("../middleware/authMiddleware");



router.post("/seed", requireAdmin, seedCompanyList);


router.post("/", requireAdmin, addCompany);


router.get("/", requireExtendedViewer, getCompanies);

module.exports = router;
