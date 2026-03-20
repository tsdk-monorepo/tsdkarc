import { defineModule, ContextOf, Module } from "../src";

export const A = defineModule()({
  name: "A",
  modules: [] as const,
  boot: () => ({
    value: "module:A",
    echo() {
      console.log("hello");
      return "ok" as string;
    },
  }),
  async shutdown(ctx) {
    ctx.echo();
    ctx.value;
    // @ts-expect-error
    ctx.set;
    console.log(`shutdown ${ctx.value}`);
  },
});

type AContext2 = ContextOf<typeof A>;

const check: AContext2 = {
  value: "a",
  echo() {
    return "hi";
  },
};
