import { defineModule, InferContextBy, ContextWriterBy } from "../src";
import { A } from "./A.module";

type BOwnSlice = { 
  /** B's value */
  valueB: string
 };

export const B = defineModule<BOwnSlice>()({
  name: "B",
  modules: [A] as const,
  boot: () => ({ valueB: "module:B" }),
  async shutdown(ctx) {
    console.log(`shutdown ${ctx.valueB}`);
  },
});

type BContext = InferContextBy<typeof B>;

type BContextWritter = ContextWriterBy<typeof B>;

type a = BContextWritter['set'];