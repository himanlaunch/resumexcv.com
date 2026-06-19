// @ts-nocheck
import express from "express";
import cors from "cors";
import pinoHttpModule from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const pinoHttp = pinoHttpModule as unknown as (options: {
  logger: typeof logger;
  serializers: {
    req: (req: { id?: string; method?: string; url?: string }) => object;
    res: (res: { statusCode?: number }) => object;
  };
}) => express.RequestHandler;

const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({
  verify(req, _res, buf) {
    if (req.originalUrl === "/api/billing/webhook") {
      req.rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
