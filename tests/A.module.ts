import { defineModule, ContextOf, Module } from "../src";

type AContext = {
  /** A's value */
  value: string;
};

export const A = defineModule<AContext>()({
  name: "A",
  modules: [] as const,
  boot: () => ({ value: "module:A" }),
  async shutdown(ctx) {
    console.log(`shutdown ${ctx.value}`);
  },
});

type AContext2 = ContextOf<typeof A>;

const check: AContext2 = {
  value: "a",
};
