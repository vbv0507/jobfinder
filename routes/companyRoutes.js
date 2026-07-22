const express = require("express");

const {
    addCompany,
    getCompanies,
    seedCompanyList,
} = require("../controller/companyController");

const router = express.Router();


const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");



router.post("/seed", requireAdmin, seedCompanyList);


router.post("/", requireAdmin, addCompany);


router.get("/", requireViewer, getCompanies);

module.exports = router;
