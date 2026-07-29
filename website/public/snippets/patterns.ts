import { defineModule, type ContextOf } from "tsdkarc";
import type { Request, Response, NextFunction } from "express";

export const authModule = defineModule({
  name: "auth",
}).init(() => {
  return {
    authenticate: (req: Request, res: Response, next: NextFunction) => {
      if (!req.headers.authorization) {
        return res.status(401).end();
      }
      next();
    },
  };
});

// Optional: If you need to export the inferred type for use elsewhere
export type AuthModuleCtx = ContextOf<typeof authModule>;
// Evaluates to: { auth: { authenticate: (req, res, next) => void } }
