import { defineModule } from "tsdkarc";
import { Request, Response, NextFunction } from "express";

interface AuthSlice {
  authenticate: (req: Request, res: Response, next: NextFunction) => void;
}

export const authModule = defineModule<AuthSlice>()({
  name: "auth",
  boot(ctx) {
    ctx.set("authenticate", (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).end();
      next();
    });
  },
});
