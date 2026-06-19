import { Router } from "express";
import { saveCookies, deleteCookies, hasCookies } from "../lib/ytdlp-manager";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({ hasCookies: hasCookies() });
});

router.post("/save", (req, res) => {
  const { cookies } = req.body as { cookies?: string };
  if (!cookies || typeof cookies !== "string" || cookies.trim().length < 10) {
    res.status(400).json({ error: "Invalid cookies content." });
    return;
  }
  if (!cookies.includes("youtube.com") && !cookies.includes("VISITOR_INFO")) {
    res.status(400).json({ error: "These don't look like YouTube cookies. Make sure you export from youtube.com." });
    return;
  }
  saveCookies(cookies.trim());
  res.json({ success: true, message: "Cookies saved successfully." });
});

router.delete("/delete", (_req, res) => {
  deleteCookies();
  res.json({ success: true, message: "Cookies deleted." });
});

export default router;
