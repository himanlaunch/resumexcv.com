// @ts-nocheck
import { Router } from "express";
import { getSupabaseUser } from "../lib/auth.js";

const router = Router();

router.get("/me", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  return res.json({ user });
});

export default router;
