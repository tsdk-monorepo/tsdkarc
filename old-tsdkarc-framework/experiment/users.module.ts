import { defineModule } from "tsdkarc";
import { eq } from "drizzle-orm";
import { type Context } from "hono";
import { dbModule } from "./db.module";
import { loggerModule } from "./logger.module";
import { users } from "./schema";
import { createEmitter } from "./typed-emitter";

type UserEvents = {
  created: { id: number; name: string; email: string };
  updated: { id: number; name: string; email: string };
  deleted: { id: number };
};

export const usersModule = defineModule()({
  name: "users",
  modules: [dbModule, loggerModule] as const,
  boot(ctx) {
    const { db, logger } = ctx;
    const emitter = createEmitter<UserEvents>();

    const repo = {
      findAll: () => db.select().from(users).orderBy(users.id),

      findById: (id: number) =>
        db
          .select()
          .from(users)
          .where(eq(users.id, id))
          .then((r) => r[0] ?? null),

      async create(name: string, email: string) {
        const user = await db
          .insert(users)
          .values({ name, email })
          .returning()
          .then((r) => r[0]);
        emitter.emit("created", user);
        logger.info({ userId: user.id }, "user created");
        return user;
      },

      async update(id: number, name: string, email: string) {
        const user = await db
          .update(users)
          .set({ name, email })
          .where(eq(users.id, id))
          .returning()
          .then((r) => r[0] ?? null);
        if (user) emitter.emit("updated", user);
        return user;
      },

      async delete(id: number) {
        const deleted = await db
          .delete(users)
          .where(eq(users.id, id))
          .returning()
          .then((r) => r[0] ?? null);
        if (deleted) emitter.emit("deleted", { id });
        return deleted;
      },
    };

    const routes = [
      {
        method: "get",
        path: "/users",
        handler: (c: Context) => repo.findAll().then((all) => c.json(all)),
      },
      {
        method: "get",
        path: "/users/:id",
        async handler(c: Context) {
          const id = Number(c.req.param("id"));
          if (isNaN(id)) return c.json({ error: "invalid id" }, 400);
          const user = await repo.findById(id);
          if (!user) return c.json({ error: "not found" }, 404);
          return c.json(user);
        },
      },
      {
        method: "post",
        path: "/users",
        async handler(c: Context) {
          const { name, email } = await c.req.json<{
            name: string;
            email: string;
          }>();
          if (!name || !email)
            return c.json({ error: "name and email required" }, 400);
          return c.json(await repo.create(name, email), 201);
        },
      },
      {
        method: "put",
        path: "/users/:id",
        async handler(c: Context) {
          const id = Number(c.req.param("id"));
          if (isNaN(id)) return c.json({ error: "invalid id" }, 400);
          const { name, email } = await c.req.json<{
            name: string;
            email: string;
          }>();
          if (!name || !email)
            return c.json({ error: "name and email required" }, 400);
          const user = await repo.update(id, name, email);
          if (!user) return c.json({ error: "not found" }, 404);
          return c.json(user);
        },
      },
      {
        method: "delete",
        path: "/users/:id",
        async handler(c: Context) {
          const id = Number(c.req.param("id"));
          if (isNaN(id)) return c.json({ error: "invalid id" }, 400);
          const user = await repo.delete(id);
          if (!user) return c.json({ error: "not found" }, 404);
          return c.json(user);
        },
      },
    ];

    return {
      users: {
        // repo — available to other modules via ctx.users.*
        findAll: repo.findAll,
        findById: repo.findById,
        create: repo.create,
        update: repo.update,
        delete: repo.delete,
        // events — emit stays private inside boot(), only on/off exposed
        on: emitter.on,
        off: emitter.off,
      },
    };
  },
});
