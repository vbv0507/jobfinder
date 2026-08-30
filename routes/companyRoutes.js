const express = require("express");

const {
    addCompany,
    getCompanies,
    seedCompanyList,
    toggleCompanyStatus,
    scrapeCompanyDirectly
} = require("../controllers/companyController");

const router = express.Router();


const { requireAdmin, requireExtendedViewer } = require("../middleware/authMiddleware");



router.post("/seed", requireAdmin, seedCompanyList);


router.post("/", requireAdmin, addCompany);


router.get("/", requireExtendedViewer, getCompanies);

router.patch("/:id/toggle", requireAdmin, toggleCompanyStatus);

router.post("/:id/scrape", requireAdmin, scrapeCompanyDirectly);

module.exports = router;
