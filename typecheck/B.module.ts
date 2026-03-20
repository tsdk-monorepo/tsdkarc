import {
  defineModule,
  ContextOf,
  ContextWriterOf,
  ContextSetOf,
} from "../src";
import { A } from "./A.module";

type BOwnSlice = {
  /** B's value */
  valueB: string;
  b?: boolean;
};

export const B = defineModule<BOwnSlice>()({
  name: "B",
  modules: [A] as const,
  boot: () => ({ valueB: "module:B" }),
  async shutdown(ctx) {
    console.log(`shutdown ${ctx.valueB}`);
  },
});

type BContext = ContextOf<typeof B>;

type BContextWritter = ContextWriterOf<typeof B>;
type Set1 = BContextWritter["set"];

type Set2 = ContextSetOf<typeof B>;
