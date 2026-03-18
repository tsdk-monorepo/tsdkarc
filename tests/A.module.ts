import { defineModule } from "../src";

type AOwnSlice = {
  /** A's value */
  value: string;
};

export const A = defineModule<AOwnSlice>()({
  name: "A",
  modules: [] as const,
  boot: () => ({ value: "module:A" }),
  async shutdown(ctx) {
    console.log(`shutdown ${ctx.value}`);
  },
});
