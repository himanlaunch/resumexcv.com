// @ts-nocheck
import { Router } from "express";
import healthRouter from "./health.js";
import jobsRouter from "./jobs.js";
import resumeRouter from "./resume.js";
import authRouter from "./auth.js";
import billingRouter from "./billing.js";
import profileRouter from "./profile.js";
import adminRouter from "./admin.js";

const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/billing", billingRouter);
router.use("/jobs", jobsRouter);
router.use("/profile", profileRouter);
router.use("/resume", resumeRouter);
router.use("/admin", adminRouter);

export default router;
