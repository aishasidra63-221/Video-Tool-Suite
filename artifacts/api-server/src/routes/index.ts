import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videoRouter from "./video";
import cookiesRouter from "./cookies";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/video", videoRouter);
router.use("/cookies", cookiesRouter);

export default router;
